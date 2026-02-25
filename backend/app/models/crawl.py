from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url = Column(Text, nullable=False)
    mode = Column(String(20), nullable=False, default="web")        # web | ios_app
    depth = Column(Integer, nullable=False, default=3)
    render_js = Column(Boolean, nullable=False, default=False)
    output_format = Column(String(20), nullable=False, default="markdown")  # markdown|html|json
    restrict_domain = Column(Boolean, nullable=False, default=True)
    respect_robots = Column(Boolean, nullable=False, default=True)
    screenshot = Column(Boolean, nullable=False, default=False)
    options = Column(JSONB, default=dict)
    status = Column(String(20), nullable=False, default="pending", index=True)
    # pending | queued | running | completed | failed | cancelled
    stats = Column(JSONB, default=dict)  # urls_crawled, urls_failed, duration_s
    error = Column(Text)
    created_at = Column(
        DateTime(timezone=True), nullable=False,
        server_default=text("NOW()"), index=True,
    )
    updated_at = Column(
        DateTime(timezone=True), nullable=False,
        server_default=text("NOW()"), onupdate=datetime.utcnow,
    )
    completed_at = Column(DateTime(timezone=True))

    results = relationship(
        "CrawlResult", back_populates="job", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_crawl_jobs_created_at", "created_at"),
    )


class CrawlResult(Base):
    __tablename__ = "crawl_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("crawl_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url = Column(Text, nullable=False)
    source_type = Column(String(20), nullable=False, default="web")  # web | ios_app
    title = Column(Text)
    content_markdown = Column(Text)
    content_html = Column(Text)
    page_metadata = Column("metadata", JSONB, default=dict)
    links = Column(JSONB, default=list)
    structured_data = Column(JSONB, default=dict)
    status_code = Column(Integer)
    depth = Column(Integer, nullable=False, default=0)
    error = Column(Text)
    screenshot_key = Column(Text)   # S3 key
    raw_html_key = Column(Text)     # S3 key
    timestamp = Column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )

    job = relationship("CrawlJob", back_populates="results")

    __table_args__ = (
        Index("idx_crawl_results_job_id", "job_id"),
        Index("idx_crawl_results_job_url", "job_id", "url", unique=True),
    )
