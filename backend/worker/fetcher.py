from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Optional

import httpx
from playwright.async_api import async_playwright, Browser, BrowserContext
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.utils.content import detect_cloudflare_block, detect_captcha
from app.utils.logging import get_logger
from worker.anti_bot import (
    apply_playwright_stealth,
    jitter_delay,
    playwright_stealth_args,
    random_headers,
    random_user_agent,
)

log = get_logger(__name__)

JS_HEAVY_SIGNALS = [
    "data-react-root",
    "__NEXT_DATA__",
    "ng-app",
    "__vue",
    "<div id=\"app\">",
    "window.__nuxt",
    "data-ember-action",
    "data-svelte",
]


@dataclass
class FetchResult:
    url: str
    html: str
    status_code: int
    final_url: str
    screenshot: Optional[bytes] = None
    error: Optional[str] = None
    rendered: bool = False
    cloudflare_blocked: bool = False
    captcha_detected: bool = False


class BrowserPool:
    """Manages a shared Playwright browser instance across worker tasks."""

    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._lock = asyncio.Lock()

    async def start(self):
        async with self._lock:
            if self._browser is None:
                self._playwright = await async_playwright().start()
                self._browser = await self._playwright.chromium.launch(
                    headless=True,
                    args=playwright_stealth_args(),
                )
                log.info("Playwright browser started")

    async def new_context(self, proxy_url: Optional[str] = None) -> BrowserContext:
        await self.start()
        ua = random_user_agent()
        proxy = {"server": proxy_url} if proxy_url else None
        ctx = await self._browser.new_context(
            user_agent=ua,
            viewport={"width": 1280, "height": 800},
            proxy=proxy,
            ignore_https_errors=True,
        )
        return ctx

    async def close(self):
        async with self._lock:
            if self._browser:
                await self._browser.close()
                self._browser = None
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None


# Module-level pool shared across coroutines in the same worker process
_pool: Optional[BrowserPool] = None


def get_browser_pool() -> BrowserPool:
    global _pool
    if _pool is None:
        _pool = BrowserPool()
    return _pool


async def close_browser_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def _needs_rendering(html: str) -> bool:
    """Heuristic: check if the page seems to be a SPA/JS-rendered shell."""
    body_content = html[html.lower().find("<body"):] if "<body" in html.lower() else html
    if len(body_content.strip()) < 500:
        return True
    return any(signal in html for signal in JS_HEAVY_SIGNALS)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.TransportError, httpx.TimeoutException)),
    reraise=True,
)
async def _fetch_static(
    url: str,
    timeout: int = 30,
    proxy_url: Optional[str] = None,
) -> FetchResult:
    headers = random_headers()
    proxy = proxy_url or None
    async with httpx.AsyncClient(
        headers=headers,
        timeout=timeout,
        follow_redirects=True,
        http2=True,
        proxy=proxy,
        verify=False,
    ) as client:
        resp = await client.get(url)
        html = resp.text
        return FetchResult(
            url=url,
            html=html,
            status_code=resp.status_code,
            final_url=str(resp.url),
            rendered=False,
            cloudflare_blocked=detect_cloudflare_block(html),
            captcha_detected=detect_captcha(html),
        )


async def _fetch_rendered(
    url: str,
    timeout: int = 30,
    screenshot: bool = False,
    proxy_url: Optional[str] = None,
) -> FetchResult:
    pool = get_browser_pool()
    ctx = await pool.new_context(proxy_url=proxy_url)
    try:
        page = await ctx.new_page()
        await apply_playwright_stealth(page)

        response = await page.goto(url, timeout=timeout * 1000, wait_until="networkidle")
        # Wait a bit for JS to settle
        await asyncio.sleep(1.5)

        html = await page.content()
        final_url = page.url
        status_code = response.status if response else 200

        screenshot_data: Optional[bytes] = None
        if screenshot:
            screenshot_data = await page.screenshot(full_page=True, type="png")

        return FetchResult(
            url=url,
            html=html,
            status_code=status_code,
            final_url=final_url,
            screenshot=screenshot_data,
            rendered=True,
            cloudflare_blocked=detect_cloudflare_block(html),
            captcha_detected=detect_captcha(html),
        )
    except Exception as e:
        log.warning("Playwright fetch error", url=url, error=str(e))
        raise
    finally:
        await ctx.close()


async def fetch(
    url: str,
    render_js: bool = False,
    timeout: int = 30,
    screenshot: bool = False,
    proxy_url: Optional[str] = None,
) -> FetchResult:
    """
    Fetch a URL. Auto-detects when JS rendering is needed.
    Falls back to Playwright if httpx gets a CF block or tiny response.
    """
    if not render_js:
        try:
            result = await _fetch_static(url, timeout=timeout, proxy_url=proxy_url)
            if result.cloudflare_blocked or _needs_rendering(result.html):
                log.debug("Falling back to Playwright", url=url)
                return await _fetch_rendered(url, timeout=timeout, screenshot=screenshot, proxy_url=proxy_url)
            return result
        except Exception as e:
            log.warning("Static fetch failed, trying Playwright", url=url, error=str(e))
            try:
                return await _fetch_rendered(url, timeout=timeout, screenshot=screenshot, proxy_url=proxy_url)
            except Exception as e2:
                return FetchResult(
                    url=url, html="", status_code=0, final_url=url, error=str(e2)
                )
    else:
        try:
            return await _fetch_rendered(url, timeout=timeout, screenshot=screenshot, proxy_url=proxy_url)
        except Exception as e:
            return FetchResult(url=url, html="", status_code=0, final_url=url, error=str(e))
