from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import extruct
import html2text
import trafilatura
from bs4 import BeautifulSoup

from app.utils.logging import get_logger

log = get_logger(__name__)

_h2t = html2text.HTML2Text()
_h2t.ignore_links = False
_h2t.ignore_images = False
_h2t.body_width = 0


def html_to_markdown(html: str) -> str:
    try:
        extracted = trafilatura.extract(
            html,
            include_links=True,
            include_images=True,
            include_tables=True,
            no_fallback=False,
            output_format="markdown",
        )
        if extracted and len(extracted.strip()) > 50:
            return extracted
    except Exception as e:
        log.debug("trafilatura failed", error=str(e))

    # Fallback: html2text
    try:
        return _h2t.handle(html)
    except Exception as e:
        log.debug("html2text failed", error=str(e))
        return ""


def extract_metadata(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    meta: Dict[str, Any] = {}

    # Title
    title_tag = soup.find("title")
    meta["title"] = title_tag.get_text(strip=True) if title_tag else None

    # Meta tags
    for tag in soup.find_all("meta"):
        name = tag.get("name", "").lower()
        prop = tag.get("property", "").lower()
        content = tag.get("content", "")

        if name == "description":
            meta["description"] = content
        elif name == "keywords":
            meta["keywords"] = content
        elif name == "author":
            meta["author"] = content
        elif name == "robots":
            meta["robots_meta"] = content
        elif prop == "og:title":
            meta["og_title"] = content
        elif prop == "og:description":
            meta["og_description"] = content
        elif prop == "og:image":
            meta["og_image"] = content
        elif prop == "og:type":
            meta["og_type"] = content
        elif prop == "og:url":
            meta["og_url"] = content
        elif prop == "twitter:title":
            meta.setdefault("twitter_title", content)
        elif prop == "twitter:description":
            meta.setdefault("twitter_description", content)

    # Canonical
    canonical = soup.find("link", rel="canonical")
    if canonical:
        meta["canonical"] = canonical.get("href")

    return {k: v for k, v in meta.items() if v}


def extract_structured_data(html: str, url: str) -> Dict[str, Any]:
    """Extract JSON-LD, microdata, OpenGraph, and RDFa using extruct."""
    try:
        data = extruct.extract(
            html,
            base_url=url,
            syntaxes=["json-ld", "microdata", "opengraph", "rdfa"],
            uniform=True,
        )
        # Remove empty sections
        return {k: v for k, v in data.items() if v}
    except Exception as e:
        log.debug("extruct failed", error=str(e))
        return {}


def extract_links(html: str, base_url: str) -> List[str]:
    """Extract all <a href> links from HTML, resolved to absolute URLs."""
    soup = BeautifulSoup(html, "lxml")
    links: List[str] = []
    seen: set = set()

    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        try:
            full = urljoin(base_url, href)
            if full not in seen and full.startswith(("http://", "https://")):
                seen.add(full)
                links.append(full)
        except Exception:
            continue

    return links


def detect_pagination(html: str, base_url: str) -> Optional[str]:
    """Try to find a 'next page' link."""
    soup = BeautifulSoup(html, "lxml")
    # rel="next"
    nxt = soup.find("link", rel="next")
    if nxt and nxt.get("href"):
        return urljoin(base_url, nxt["href"])
    # Common anchor texts
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(strip=True).lower()
        if text in ("next", "next page", "›", "»", "next »", ">"):
            return urljoin(base_url, anchor["href"])
    return None


def detect_cloudflare_block(html: str) -> bool:
    signals = [
        "Checking if the site connection is secure",
        "cf-browser-verification",
        "cloudflare-static",
        "Just a moment",
        "Enable JavaScript and cookies to continue",
    ]
    return any(s in html for s in signals)


def detect_captcha(html: str) -> bool:
    signals = [
        "g-recaptcha",
        "hcaptcha",
        "recaptcha",
        "__cf_chl_captcha",
        "captcha",
    ]
    return any(s.lower() in html.lower() for s in signals)
