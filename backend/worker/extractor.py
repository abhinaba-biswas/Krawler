from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.utils.content import (
    detect_captcha,
    detect_cloudflare_block,
    detect_pagination,
    extract_links,
    extract_metadata,
    extract_structured_data,
    html_to_markdown,
)
from app.utils.logging import get_logger

log = get_logger(__name__)


def extract_page(
    html: str,
    url: str,
    output_format: str = "markdown",
) -> Dict[str, Any]:
    """
    Full content extraction pipeline.
    Returns a dict ready to be stored as a CrawlResult row.
    """
    if not html or not html.strip():
        return _empty(url)

    metadata = extract_metadata(html, url)
    title = metadata.pop("title", None)

    structured_data = extract_structured_data(html, url)
    links = extract_links(html, url)
    next_page = detect_pagination(html, url)

    content_markdown: Optional[str] = None
    content_html: Optional[str] = None

    if output_format == "markdown":
        content_markdown = html_to_markdown(html)
    elif output_format == "html":
        content_html = _clean_html(html)
    elif output_format == "json":
        # JSON output: structured_data + metadata only
        pass
    else:
        content_markdown = html_to_markdown(html)

    if next_page and next_page not in links:
        links.append(next_page)

    return {
        "title": title,
        "content_markdown": content_markdown,
        "content_html": content_html,
        "metadata": metadata,
        "links": links,
        "structured_data": structured_data,
        "cloudflare_blocked": detect_cloudflare_block(html),
        "captcha_detected": detect_captcha(html),
        "next_page": next_page,
    }


def _empty(url: str) -> Dict[str, Any]:
    return {
        "title": None,
        "content_markdown": None,
        "content_html": None,
        "metadata": {},
        "links": [],
        "structured_data": {},
        "cloudflare_blocked": False,
        "captcha_detected": False,
        "next_page": None,
    }


def _clean_html(html: str) -> str:
    """Return a cleaned version of HTML (strip scripts, styles, ads)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "iframe", "svg"]):
        tag.decompose()
    return str(soup)
