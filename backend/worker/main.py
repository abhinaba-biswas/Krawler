from __future__ import annotations

"""
arq worker entrypoint.

Run with:
    python -m arq worker.main.WorkerSettings
"""

import sys
import os

# Ensure backend/ is on path when running from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from typing import Any, Dict

from arq import cron
from arq.connections import RedisSettings

from app.config import settings
from app.core.database import async_session_factory, init_db
from app.utils.logging import configure_logging, get_logger
from worker.crawler import run_crawl
from worker.fetcher import close_browser_pool

configure_logging(debug=settings.DEBUG)
log = get_logger("worker")


# ── Task functions ─────────────────────────────────────────────────────────────

async def crawl_job(ctx: Dict[str, Any], job_id: str, job_kwargs: Dict[str, Any]) -> str:
    """
    Main crawl task executed by the arq worker.
    `ctx` is injected by arq and contains shared resources set up in startup.
    """
    redis = ctx["redis"]
    log.info("Worker picked up crawl job", job_id=job_id, **job_kwargs)

    async with async_session_factory() as db:
        await run_crawl(
            db=db,
            redis=redis,
            job_id=job_id,
            **job_kwargs,
        )

    return f"completed:{job_id}"


# ── Worker lifecycle hooks ─────────────────────────────────────────────────────

async def startup(ctx: Dict[str, Any]) -> None:
    log.info("Worker starting up")
    await init_db()
    # ctx['redis'] is already set by arq to the worker's redis connection
    log.info("Worker ready")


async def shutdown(ctx: Dict[str, Any]) -> None:
    log.info("Worker shutting down")
    await close_browser_pool()


# ── Worker settings ────────────────────────────────────────────────────────────

def _redis_settings() -> RedisSettings:
    import urllib.parse
    parsed = urllib.parse.urlparse(settings.REDIS_URL)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        password=parsed.password,
        database=int(parsed.path.lstrip("/") or 0),
    )


class WorkerSettings:
    functions = [crawl_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = _redis_settings()
    max_jobs = settings.WORKER_CONCURRENCY
    job_timeout = 3600          # 1 hour max per job
    keep_result = 86400         # keep result in Redis for 24h
    max_tries = 1               # crawl jobs are not retried automatically
    health_check_interval = 30
    queue_read_limit = settings.WORKER_CONCURRENCY
