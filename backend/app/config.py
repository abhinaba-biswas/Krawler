from __future__ import annotations

from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "Krawler"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://krawler:krawler@localhost:5432/krawler"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379"

    # ── Object Storage (S3 / MinIO) ───────────────────────────────────────────
    S3_ENDPOINT_URL: Optional[str] = None  # None = AWS, set for MinIO
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "krawler"
    S3_REGION: str = "us-east-1"

    # ── Crawling Defaults ─────────────────────────────────────────────────────
    DEFAULT_DEPTH: int = 3
    MAX_DEPTH: int = 10
    DEFAULT_CONCURRENCY: int = 5
    MAX_CONCURRENCY: int = 20
    DEFAULT_TIMEOUT: int = 30
    MAX_RETRIES: int = 3
    RATE_LIMIT_RPS: float = 1.0          # requests per second per domain
    IDLE_TIMEOUT_S: int = 30             # stop if no new URLs for N seconds
    SCREENSHOT: bool = False

    # ── Worker ────────────────────────────────────────────────────────────────
    WORKER_CONCURRENCY: int = 10

    # ── API ───────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    API_KEY: Optional[str] = None        # if set, all requests need X-API-Key

    # ── Metrics ───────────────────────────────────────────────────────────────
    ENABLE_METRICS: bool = True


settings = Settings()
