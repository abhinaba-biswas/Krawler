from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

crawl_urls_total = Counter(
    "krawler_crawl_urls_total",
    "Total URLs processed by the crawler",
    ["status"],  # success, failed, skipped
)

crawl_jobs_total = Counter(
    "krawler_crawl_jobs_total",
    "Total crawl jobs processed",
    ["status"],  # completed, failed, cancelled
)

crawl_duration_seconds = Histogram(
    "krawler_crawl_duration_seconds",
    "Duration of individual page fetches",
    ["rendered"],  # true, false
    buckets=[0.1, 0.5, 1, 2, 5, 10, 30, 60],
)

job_duration_seconds = Histogram(
    "krawler_job_duration_seconds",
    "Total duration of crawl jobs",
    buckets=[1, 5, 30, 60, 300, 600, 1800, 3600],
)

active_workers = Gauge(
    "krawler_active_workers",
    "Number of currently active crawl workers",
)

frontier_size = Gauge(
    "krawler_frontier_size",
    "Current URL frontier size",
    ["job_id"],
)

rate_limit_delays_total = Counter(
    "krawler_rate_limit_delays_total",
    "Total number of rate-limit enforced delays",
    ["domain"],
)

cloudflare_blocks_total = Counter(
    "krawler_cloudflare_blocks_total",
    "Total Cloudflare blocks detected",
)

captcha_detections_total = Counter(
    "krawler_captcha_detections_total",
    "Total CAPTCHA detections",
)
