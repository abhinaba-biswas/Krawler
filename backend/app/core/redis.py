from __future__ import annotations

from typing import Optional

import redis.asyncio as aioredis
from arq.connections import RedisSettings, create_pool

from app.config import settings

_redis_pool: Optional[aioredis.Redis] = None
_arq_pool = None

# ── Generic Redis pool ─────────────────────────────────────────────────────────

async def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_pool


async def close_redis() -> None:
    global _redis_pool
    if _redis_pool:
        await _redis_pool.aclose()
        _redis_pool = None


# ── arq pool (for enqueuing jobs) ─────────────────────────────────────────────

def _arq_redis_settings() -> RedisSettings:
    import urllib.parse
    parsed = urllib.parse.urlparse(settings.REDIS_URL)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        password=parsed.password,
        database=int(parsed.path.lstrip("/") or 0),
    )


async def get_arq_pool():
    global _arq_pool
    if _arq_pool is None:
        _arq_pool = await create_pool(_arq_redis_settings())
    return _arq_pool


async def close_arq_pool() -> None:
    global _arq_pool
    if _arq_pool:
        await _arq_pool.aclose()
        _arq_pool = None


# ── Key builders ───────────────────────────────────────────────────────────────

def frontier_key(job_id: str) -> str:
    return f"krawler:frontier:{job_id}"


def visited_key(job_id: str) -> str:
    return f"krawler:visited:{job_id}"


def rate_key(domain: str) -> str:
    return f"krawler:rate:{domain}"


def job_cancel_key(job_id: str) -> str:
    return f"krawler:cancel:{job_id}"
