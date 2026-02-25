from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, field_validator


# ── Request schemas ────────────────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    url: str = Field(..., description="Seed URL to crawl")
    depth: int = Field(3, ge=0, le=10, description="Crawl depth (0 = seed only)")
    mode: Literal["web", "ios_app"] = Field("web")
    render_js: bool = Field(False, description="Force Playwright for JS rendering")
    output: Literal["markdown", "html", "json"] = Field("markdown")
    restrict_domain: bool = Field(True, description="Stay within seed domain")
    respect_robots: bool = Field(True, description="Honor robots.txt")
    screenshot: bool = Field(False, description="Capture page screenshots")
    concurrency: int = Field(5, ge=1, le=20)
    rate_limit_rps: float = Field(1.0, gt=0, le=10, description="Requests/sec per domain")
    proxy_url: Optional[str] = Field(None, description="Optional proxy URL")

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v.rstrip("/")


# ── Response schemas ───────────────────────────────────────────────────────────

class CrawlJobStats(BaseModel):
    urls_queued: int = 0
    urls_crawled: int = 0
    urls_failed: int = 0
    duration_s: Optional[float] = None


class CrawlJobResponse(BaseModel):
    id: UUID
    url: str
    mode: str
    depth: int
    render_js: bool
    output_format: str
    status: str
    stats: CrawlJobStats
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PageMetadata(BaseModel):
    description: Optional[str] = None
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image: Optional[str] = None
    og_type: Optional[str] = None
    canonical: Optional[str] = None
    keywords: Optional[str] = None
    author: Optional[str] = None
    robots_meta: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class CrawlResultItem(BaseModel):
    id: UUID
    job_id: UUID
    url: str
    source_type: str
    title: Optional[str] = None
    content_markdown: Optional[str] = None
    content_html: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    links: Optional[List[str]] = None
    structured_data: Optional[Dict[str, Any]] = None
    status_code: Optional[int] = None
    depth: int
    error: Optional[str] = None
    screenshot_key: Optional[str] = None
    timestamp: datetime

    model_config = {"from_attributes": True}


class CrawlResultsResponse(BaseModel):
    job: CrawlJobResponse
    results: List[CrawlResultItem]
    total: int


class StatusResponse(BaseModel):
    id: UUID
    status: str
    stats: CrawlJobStats
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    checks: Dict[str, str]


# ── iOS App Store schemas ──────────────────────────────────────────────────────

class AppStoreReview(BaseModel):
    id: str
    author: str
    rating: int
    title: str
    body: str
    date: Optional[str] = None
    version: Optional[str] = None


class AppStoreResult(BaseModel):
    id: str
    url: str
    source_type: str = "ios_app"
    app_id: str
    name: str
    developer: str
    developer_id: Optional[str] = None
    category: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    version: Optional[str] = None
    description: Optional[str] = None
    release_date: Optional[str] = None
    updated_date: Optional[str] = None
    price: Optional[str] = None
    in_app_purchases: bool = False
    in_app_purchase_details: Optional[str] = None
    screenshot_urls: List[str] = Field(default_factory=list)
    icon_url: Optional[str] = None
    supported_devices: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    size_bytes: Optional[int] = None
    content_rating: Optional[str] = None
    reviews: List[AppStoreReview] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: Optional[datetime] = None
