from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.redis import get_arq_pool, job_cancel_key, get_redis
from app.models.crawl import CrawlJob, CrawlResult
from app.models.schemas import CrawlJobResponse, CrawlRequest, CrawlResultsResponse, StatusResponse
from app.utils.logging import get_logger

log = get_logger(__name__)


async def create_job(req: CrawlRequest, db: AsyncSession) -> CrawlJobResponse:
    job = CrawlJob(
        id=uuid.uuid4(),
        url=req.url,
        mode=req.mode,
        depth=req.depth,
        render_js=req.render_js,
        output_format=req.output,
        restrict_domain=req.restrict_domain,
        respect_robots=req.respect_robots,
        screenshot=req.screenshot,
        options={
            "concurrency": req.concurrency,
            "rate_limit_rps": req.rate_limit_rps,
            "proxy_url": req.proxy_url,
        },
        status="queued",
        stats={},
    )
    db.add(job)
    await db.flush()

    # Enqueue in arq
    pool = await get_arq_pool()
    await pool.enqueue_job(
        "crawl_job",
        job_id=str(job.id),
        job_kwargs={
            "url": job.url,
            "mode": job.mode,
            "depth": job.depth,
            "render_js": job.render_js,
            "output_format": job.output_format,
            "restrict_domain": job.restrict_domain,
            "respect_robots": job.respect_robots,
            "screenshot": job.screenshot,
            "concurrency": req.concurrency,
            "rate_limit_rps": req.rate_limit_rps,
            "proxy_url": req.proxy_url,
        },
        _job_id=str(job.id),
    )

    log.info("Crawl job created", job_id=str(job.id), url=job.url, mode=job.mode)
    await db.commit()
    await db.refresh(job)
    return _to_response(job)


async def get_status(job_id: UUID, db: AsyncSession) -> Optional[StatusResponse]:
    job = await db.get(CrawlJob, job_id)
    if not job:
        return None
    from app.models.schemas import CrawlJobStats
    return StatusResponse(
        id=job.id,
        status=job.status,
        stats=CrawlJobStats(**(job.stats or {})),
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        completed_at=job.completed_at,
    )


async def get_results(
    job_id: UUID, db: AsyncSession, limit: int = 100, offset: int = 0
) -> Optional[CrawlResultsResponse]:
    job = await db.get(CrawlJob, job_id)
    if not job:
        return None

    stmt = (
        select(CrawlResult)
        .where(CrawlResult.job_id == job_id)
        .order_by(CrawlResult.timestamp)
        .offset(offset)
        .limit(limit)
    )
    results = (await db.execute(stmt)).scalars().all()

    count_stmt = select(func.count()).where(CrawlResult.job_id == job_id)
    total = (await db.execute(count_stmt)).scalar_one()

    from app.models.schemas import CrawlResultItem
    return CrawlResultsResponse(
        job=_to_response(job),
        results=[CrawlResultItem.model_validate(r) for r in results],
        total=total,
    )


async def list_jobs(db: AsyncSession, limit: int = 50, offset: int = 0) -> List[CrawlJobResponse]:
    stmt = (
        select(CrawlJob)
        .order_by(CrawlJob.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    jobs = (await db.execute(stmt)).scalars().all()
    return [_to_response(j) for j in jobs]


async def cancel_job(job_id: UUID, db: AsyncSession) -> bool:
    job = await db.get(CrawlJob, job_id)
    if not job:
        return False
    if job.status not in ("queued", "running"):
        return False

    # Signal the worker to stop
    redis = await get_redis()
    await redis.set(job_cancel_key(str(job_id)), "1", ex=3600)

    job.status = "cancelled"
    job.updated_at = datetime.utcnow()
    await db.commit()
    log.info("Crawl job cancelled", job_id=str(job_id))
    return True


def _to_response(job: CrawlJob) -> CrawlJobResponse:
    from app.models.schemas import CrawlJobStats
    return CrawlJobResponse(
        id=job.id,
        url=job.url,
        mode=job.mode,
        depth=job.depth,
        render_js=job.render_js,
        output_format=job.output_format,
        status=job.status,
        stats=CrawlJobStats(**(job.stats or {})),
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        completed_at=job.completed_at,
    )
