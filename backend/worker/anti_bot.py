from __future__ import annotations

import asyncio
import random
from typing import Dict, List, Optional

try:
    from fake_useragent import UserAgent
    _ua = UserAgent()
    def random_user_agent() -> str:
        return _ua.random
except Exception:
    _FALLBACK_UAS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ]
    def random_user_agent() -> str:
        return random.choice(_FALLBACK_UAS)


def random_headers(user_agent: Optional[str] = None) -> Dict[str, str]:
    ua = user_agent or random_user_agent()
    return {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": random.choice([
            "en-US,en;q=0.9",
            "en-GB,en;q=0.9",
            "en-US,en;q=0.8,de;q=0.7",
        ]),
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": random.choice(["no-cache", "max-age=0"]),
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": random.choice(["none", "same-origin", "cross-site"]),
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "DNT": random.choice(["0", "1"]),
    }


async def jitter_delay(base_rps: float = 1.0) -> None:
    """Wait with randomized jitter based on rate limit."""
    base_delay = 1.0 / base_rps
    jitter = random.uniform(0, base_delay * 0.5)
    await asyncio.sleep(base_delay + jitter)


async def enforce_rate_limit(domain: str, redis, rps: float = 1.0) -> None:
    """
    Token-bucket rate limiting per domain using Redis.
    Blocks until a token is available.
    """
    key = f"krawler:rate:{domain}"
    min_interval_ms = int(1000 / rps)

    while True:
        now_ms = int(asyncio.get_event_loop().time() * 1000)
        last_ms = await redis.get(key)

        if last_ms is None:
            await redis.set(key, now_ms, px=min_interval_ms * 2)
            return

        last_ms = int(last_ms)
        elapsed = now_ms - last_ms

        if elapsed >= min_interval_ms:
            await redis.set(key, now_ms, px=min_interval_ms * 2)
            return

        wait_s = (min_interval_ms - elapsed) / 1000.0 + random.uniform(0.05, 0.15)
        await asyncio.sleep(wait_s)


def playwright_stealth_args() -> List[str]:
    """Args to make Playwright less detectable."""
    return [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-extensions",
        "--disable-dev-shm-usage",
        "--no-sandbox",
    ]


async def apply_playwright_stealth(page) -> None:
    """Apply stealth patches to a Playwright page."""
    await page.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    """)
