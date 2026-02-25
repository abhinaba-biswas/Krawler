from __future__ import annotations

import hashlib
from urllib.parse import urljoin, urlparse, urlunparse


def normalize(url: str) -> str:
    """Normalize a URL: lowercase scheme+host, strip fragments, sort params."""
    try:
        p = urlparse(url.strip())
        normalized = urlunparse((
            p.scheme.lower(),
            p.netloc.lower(),
            p.path.rstrip("/") or "/",
            p.params,
            p.query,
            "",  # strip fragment
        ))
        return normalized
    except Exception:
        return url


def url_hash(url: str) -> str:
    return hashlib.sha1(normalize(url).encode()).hexdigest()


def domain_of(url: str) -> str:
    return urlparse(url).netloc.lower()


def same_domain(url1: str, url2: str) -> bool:
    return domain_of(url1) == domain_of(url2)


def resolve(base: str, href: str) -> str | None:
    """Resolve href relative to base, return None if not http/https."""
    try:
        full = urljoin(base, href.strip())
        scheme = urlparse(full).scheme
        if scheme not in ("http", "https"):
            return None
        return normalize(full)
    except Exception:
        return None


def is_crawlable(url: str) -> bool:
    """Skip common non-page file extensions."""
    skip_extensions = {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".zip", ".tar", ".gz", ".rar", ".7z",
        ".mp3", ".mp4", ".avi", ".mov", ".mkv",
        ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
    }
    path = urlparse(url).path.lower()
    return not any(path.endswith(ext) for ext in skip_extensions)
