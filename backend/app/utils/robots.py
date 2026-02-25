from __future__ import annotations

import asyncio
from functools import lru_cache
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from app.utils.logging import get_logger

log = get_logger(__name__)

_cache: dict[str, RobotFileParser] = {}
_lock = asyncio.Lock()


async def is_allowed(url: str, user_agent: str = "*") -> bool:
    """Return True if the given URL is allowed by robots.txt."""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

    async with _lock:
        if robots_url not in _cache:
            parser = await _fetch_robots(robots_url)
            _cache[robots_url] = parser

    parser = _cache[robots_url]
    return parser.can_fetch(user_agent, url)


async def _fetch_robots(robots_url: str) -> RobotFileParser:
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(robots_url, follow_redirects=True)
            if resp.status_code == 200:
                parser.parse(resp.text.splitlines())
            else:
                # No robots.txt → allow all
                parser.allow_all = True
    except Exception as e:
        log.warning("Failed to fetch robots.txt", url=robots_url, error=str(e))
        parser.allow_all = True
    return parser


def clear_cache() -> None:
    _cache.clear()
