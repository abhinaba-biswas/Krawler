from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.redis import frontier_key, job_cancel_key, visited_key
from app.models.crawl import CrawlJob, CrawlResult
from app.services.ios_scraper import scrape_app_store
from app.utils.logging import get_logger
from app.utils.robots import is_allowed
from app.utils.url import domain_of, is_crawlable, normalize, resolve, same_domain
from worker.anti_bot import enforce_rate_limit
from worker.extractor import extract_page
from worker.fetcher import fetch, close_browser_pool
from worker.metrics import (
    active_workers,
    captcha_detections_total,
    cloudflare_blocks_total,
    crawl_duration_seconds,
    crawl_urls_total,
    frontier_size as frontier_size_gauge,
    job_duration_seconds,
)

log = get_logger(__name__)


async def run_crawl(
    db: AsyncSession,
    redis: aioredis.Redis,
    job_id: str,
    url: str,
    mode: str = "web",
    depth: int = 3,
    render_js: bool = False,
    output_format: str = "markdown",
    restrict_domain: bool = True,
    respect_robots: bool = True,
    screenshot: bool = False,
    concurrency: int = 5,
    rate_limit_rps: float = 1.0,
    proxy_url: Optional[str] = None,
) -> None:
    """
    Main crawl orchestrator. Implements BFS with Redis-backed frontier.
    """
    start_time = time.monotonic()
    active_workers.inc()

    stats = {"urls_queued": 0, "urls_crawled": 0, "urls_failed": 0}

    try:
        if mode == "ios_app":
            await _crawl_ios(db, job_id, url, stats)
        else:
            await _crawl_web(
                db, redis, job_id, url, depth, render_js, output_format,
                restrict_domain, respect_robots, screenshot, concurrency,
                rate_limit_rps, proxy_url, stats,
            )

        # Mark job completed
        await _update_job(
            db, job_id, "completed",
            stats=stats,
            completed_at=datetime.now(timezone.utc),
        )
        crawl_urls_total.labels(status="success").inc(stats["urls_crawled"])
        crawl_jobs_total.labels(status="completed").inc()

    except asyncio.CancelledError:
        await _update_job(db, job_id, "cancelled", stats=stats)
        crawl_jobs_total.labels(status="cancelled").inc()
        raise

    except Exception as e:
        log.error("Crawl job failed", job_id=job_id, error=str(e), exc_info=True)
        await _update_job(db, job_id, "failed", stats=stats, error=str(e))
        crawl_jobs_total.labels(status="failed").inc()

    finally:
        active_workers.dec()
        elapsed = time.monotonic() - start_time
        job_duration_seconds.observe(elapsed)
        stats["duration_s"] = round(elapsed, 2)
        # Cleanup Redis keys
        await redis.delete(frontier_key(job_id), visited_key(job_id), job_cancel_key(job_id))
        log.info("Crawl complete", job_id=job_id, stats=stats)


# ── Web crawler ────────────────────────────────────────────────────────────────

async def _crawl_web(
    db: AsyncSession,
    redis: aioredis.Redis,
    job_id: str,
    seed_url: str,
    depth: int,
    render_js: bool,
    output_format: str,
    restrict_domain: bool,
    respect_robots: bool,
    screenshot: bool,
    concurrency: int,
    rate_limit_rps: float,
    proxy_url: Optional[str],
    stats: Dict[str, int],
) -> None:
    fkey = frontier_key(job_id)
    vkey = visited_key(job_id)
    ckey = job_cancel_key(job_id)
    seed_domain = domain_of(seed_url)

    # Seed the frontier: (url, depth) stored as ZSET score=depth
    norm_seed = normalize(seed_url)
    await redis.zadd(fkey, {norm_seed: 0})
    await redis.expire(fkey, 86400)
    await redis.expire(vkey, 86400)
    stats["urls_queued"] = 1

    semaphore = asyncio.Semaphore(concurrency)

    while True:
        # Check for cancellation
        if await redis.exists(ckey):
            log.info("Crawl cancelled by request", job_id=job_id)
            break

        # Pull a batch from the frontier (lowest score = shallowest depth)
        batch_raw = await redis.zrange(fkey, 0, concurrency - 1, withscores=True)
        if not batch_raw:
            break

        # Remove pulled URLs from frontier
        batch_urls = [item[0] for item in batch_raw]
        await redis.zrem(fkey, *batch_urls)
        await redis.sadd(vkey, *batch_urls)

        current_size = await redis.zcard(fkey)
        frontier_size_gauge.labels(job_id=job_id).set(current_size)

        tasks = [
            _process_url(
                db, redis, job_id, url, int(score), depth, render_js,
                output_format, screenshot, restrict_domain, respect_robots,
                seed_domain, fkey, vkey, rate_limit_rps, proxy_url, stats, semaphore,
            )
            for url, score in batch_raw
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    log.info("Frontier exhausted", job_id=job_id, **stats)


async def _process_url(
    db: AsyncSession,
    redis: aioredis.Redis,
    job_id: str,
    url: str,
    current_depth: int,
    max_depth: int,
    render_js: bool,
    output_format: str,
    screenshot: bool,
    restrict_domain: bool,
    respect_robots: bool,
    seed_domain: str,
    fkey: str,
    vkey: str,
    rate_limit_rps: float,
    proxy_url: Optional[str],
    stats: Dict[str, int],
    semaphore: asyncio.Semaphore,
) -> None:
    async with semaphore:
        domain = domain_of(url)

        # robots.txt check
        if respect_robots and not await is_allowed(url):
            log.debug("Blocked by robots.txt", url=url)
            crawl_urls_total.labels(status="skipped").inc()
            return

        # Rate limit
        await enforce_rate_limit(domain, redis, rps=rate_limit_rps)

        # Fetch
        t0 = time.monotonic()
        result = await fetch(
            url,
            render_js=render_js,
            screenshot=screenshot,
            proxy_url=proxy_url,
        )
        elapsed = time.monotonic() - t0
        crawl_duration_seconds.labels(rendered=str(result.rendered)).observe(elapsed)

        if result.cloudflare_blocked:
            cloudflare_blocks_total.inc()
        if result.captcha_detected:
            captcha_detections_total.inc()

        # Extract
        extracted = {}
        screenshot_key: Optional[str] = None
        raw_html_key: Optional[str] = None

        if result.html and result.status_code < 400:
            extracted = extract_page(result.html, result.final_url, output_format)
            stats["urls_crawled"] += 1
            crawl_urls_total.labels(status="success").inc()

            # Store raw HTML and screenshot in S3
            raw_html_key = await _store_s3(job_id, url, result.html, "html")
            if result.screenshot:
                screenshot_key = await _store_s3(job_id, url, result.screenshot, "png")
        else:
            stats["urls_failed"] += 1
            crawl_urls_total.labels(status="failed").inc()

        # Persist result
        await _save_result(
            db, job_id, url, extracted, result.status_code,
            current_depth, result.error, screenshot_key, raw_html_key,
        )

        # Update running stats
        await _update_job(db, job_id, "running", stats=stats)

        # Discover new URLs
        if current_depth < max_depth:
            new_links = extracted.get("links", [])
            await _enqueue_links(
                redis, fkey, vkey, new_links, current_depth + 1,
                restrict_domain, seed_domain,
            )
            stats["urls_queued"] += len(new_links)


async def _enqueue_links(
    redis: aioredis.Redis,
    fkey: str,
    vkey: str,
    links: List[str],
    next_depth: int,
    restrict_domain: bool,
    seed_domain: str,
) -> None:
    if not links:
        return

    pipeline = redis.pipeline()
    for link in links:
        if not is_crawlable(link):
            continue
        if restrict_domain and not same_domain(link, f"https://{seed_domain}"):
            continue
        norm = normalize(link)
        # Only add if not already visited or in frontier
        # We use a Lua-style check via SISMEMBER + ZADD NX
        pipeline.sismember(vkey, norm)

    results = await pipeline.execute()

    to_add = {}
    for link, already_visited in zip(links, results):
        if not already_visited and is_crawlable(link):
            if restrict_domain and not same_domain(link, f"https://{seed_domain}"):
                continue
            norm = normalize(link)
            to_add[norm] = next_depth

    if to_add:
        await redis.zadd(fkey, to_add, nx=True)


# ── iOS crawler ────────────────────────────────────────────────────────────────

async def _crawl_ios(
    db: AsyncSession,
    job_id: str,
    url: str,
    stats: Dict[str, int],
) -> None:
    result = await scrape_app_store(url)
    stats["urls_crawled"] = 1

    import json
    crawl_result = CrawlResult(
        id=uuid.uuid4(),
        job_id=uuid.UUID(job_id),
        url=url,
        source_type="ios_app",
        title=result.name,
        content_markdown=f"# {result.name}\n\n{result.description or ''}",
        metadata={
            "developer": result.developer,
            "category": result.category,
            "rating": result.rating,
            "rating_count": result.rating_count,
            "version": result.version,
            "price": result.price,
            "icon_url": result.icon_url,
        },
        links=result.screenshot_urls,
        structured_data=result.model_dump(),
        status_code=200,
        depth=0,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(crawl_result)
    await db.commit()


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _save_result(
    db: AsyncSession,
    job_id: str,
    url: str,
    extracted: Dict[str, Any],
    status_code: int,
    depth: int,
    error: Optional[str],
    screenshot_key: Optional[str],
    raw_html_key: Optional[str],
) -> None:
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    result = CrawlResult(
        id=uuid.uuid4(),
        job_id=uuid.UUID(job_id),
        url=url,
        source_type="web",
        title=extracted.get("title"),
        content_markdown=extracted.get("content_markdown"),
        content_html=extracted.get("content_html"),
        metadata=extracted.get("metadata", {}),
        links=extracted.get("links", []),
        structured_data=extracted.get("structured_data", {}),
        status_code=status_code,
        depth=depth,
        error=error,
        screenshot_key=screenshot_key,
        raw_html_key=raw_html_key,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(result)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        log.warning("Failed to save result (duplicate URL?)", url=url, error=str(e))


async def _update_job(
    db: AsyncSession,
    job_id: str,
    status: str,
    stats: Optional[Dict] = None,
    error: Optional[str] = None,
    completed_at: Optional[datetime] = None,
) -> None:
    job = await db.get(CrawlJob, uuid.UUID(job_id))
    if not job:
        return
    job.status = status
    job.updated_at = datetime.now(timezone.utc)
    if stats is not None:
        job.stats = stats
    if error is not None:
        job.error = error
    if completed_at is not None:
        job.completed_at = completed_at
    try:
        await db.commit()
    except Exception:
        await db.rollback()


async def _store_s3(job_id: str, url: str, data: Any, ext: str) -> Optional[str]:
    try:
        from app.core.storage import upload_bytes, upload_text
        from app.utils.url import url_hash

        key = f"crawls/{job_id}/{url_hash(url)}.{ext}"
        if ext == "html":
            upload_text(key, data if isinstance(data, str) else data.decode())
        else:
            upload_bytes(key, data if isinstance(data, bytes) else data.encode())
        return key
    except Exception as e:
        log.warning("S3 upload failed", error=str(e))
        return None
