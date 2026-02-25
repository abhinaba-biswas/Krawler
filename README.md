# Krawler v2

Production-grade **distributed web crawling and data extraction platform** — similar to Firecrawl.

```
┌─────────────┐    POST /api/crawl    ┌─────────────────┐
│  Next.js UI │ ──────────────────── ▶│  FastAPI  (API) │
│  (port 3000)│ ◀────────────────── ─│  (port 8000)    │
└─────────────┘    GET  /api/status   └────────┬────────┘
                                               │  enqueue job
                                       ┌───────▼────────┐
                                       │  Redis (arq)   │
                                       └───────┬────────┘
                                               │  job picked up
                          ┌────────────────────▼──────────────────────┐
                          │          Worker (Playwright + httpx)       │
                          │  BFS crawler  │  Content extractor         │
                          │  robots.txt   │  HTML → Markdown           │
                          │  Rate limiter │  iOS App Store scraper     │
                          └──────┬────────────────┬────────────────────┘
                                 │                │
                        ┌────────▼──────┐  ┌──────▼──────────┐
                        │  PostgreSQL   │  │  MinIO / S3     │
                        │  (results)    │  │  (raw HTML,     │
                        └───────────────┘  │   screenshots)  │
                                           └─────────────────┘
```

## Features

- **Seed-based BFS crawling** with configurable depth
- **Auto-detect JS rendering** — httpx for static, Playwright for SPAs
- **Per-domain rate limiting** with randomized jitter (Redis token bucket)
- **robots.txt compliance** with caching
- **URL deduplication** via Redis sets
- **Priority-based URL frontier** (Redis sorted sets)
- **Anti-bot**: header randomization, UA rotation, Playwright stealth
- **Cloudflare & CAPTCHA detection**
- **Content extraction**: trafilatura + extruct (JSON-LD, microdata, OG tags)
- **HTML → Markdown** conversion
- **iOS App Store scraper** mode (iTunes API + reviews RSS)
- **Screenshot capture** stored in S3
- **Raw HTML** stored in S3
- **Structured JSON output** (title, metadata, links, content, structured data)
- **Job cancellation** via Redis signal
- **Prometheus metrics** at `/metrics`
- **Structured JSON logging** (structlog)
- **Horizontal scaling** — add more workers
- **Kubernetes manifests** with HPA
- **PWA-ready** Next.js frontend

---

## Quick Start (Docker Compose)

```bash
# 1. Clone and enter directory
git clone <repo> && cd krawler

# 2. Copy env (edit if needed)
cp .env.example backend/.env

# 3. Build and start everything
docker compose up --build

# Services:
#   Frontend  →  http://localhost:3000
#   API       →  http://localhost:8000
#   API docs  →  http://localhost:8000/docs
#   MinIO UI  →  http://localhost:9001  (minioadmin / minioadmin)
```

Scale workers:
```bash
docker compose up --scale worker=5
```

---

## Development Setup

### Backend

```bash
cd backend

# Python 3.12+
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Start infrastructure
docker compose up postgres redis minio minio-init -d

# Copy and configure env
cp .env.example .env

# Run API
uvicorn app.main:app --reload --port 8000

# Run worker (separate terminal)
python -m arq worker.main.WorkerSettings
```

### Frontend

```bash
cd frontend
npm install
cp ../.env.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                      # → http://localhost:3000
```

---

## API Reference

### `POST /api/crawl`

Submit a crawl job.

```json
{
  "url": "https://example.com",
  "depth": 3,
  "mode": "web",
  "render_js": false,
  "output": "markdown",
  "restrict_domain": true,
  "respect_robots": true,
  "screenshot": false,
  "concurrency": 5,
  "rate_limit_rps": 1.0
}
```

- **mode**: `"web"` | `"ios_app"`
- **output**: `"markdown"` | `"html"` | `"json"`

Returns `202 Accepted` with job details including `id`.

### `GET /api/status/{crawl_id}`

Poll job status. Poll every 2–5 seconds until `status` is `completed|failed|cancelled`.

```json
{
  "id": "uuid",
  "status": "running",
  "stats": { "urls_crawled": 42, "urls_failed": 1, "urls_queued": 15 },
  "created_at": "...",
  "updated_at": "..."
}
```

### `GET /api/result/{crawl_id}?limit=100&offset=0`

Retrieve crawl results.

```json
{
  "job": { ... },
  "results": [
    {
      "id": "uuid",
      "url": "https://...",
      "title": "Page title",
      "content_markdown": "# ...",
      "metadata": { "description": "...", "og_image": "..." },
      "links": ["https://..."],
      "structured_data": { "json-ld": [...] },
      "status_code": 200,
      "depth": 1,
      "timestamp": "..."
    }
  ],
  "total": 142
}
```

### `GET /api/jobs`

List all jobs (most recent first).

### `POST /api/cancel/{crawl_id}`

Cancel a running or queued job.

### `POST /api/scrape/ios?url=<app-store-url>`

Synchronous iOS App Store scrape. Returns full app data + reviews.

### `GET /health`

Health check for all dependencies.

### `GET /metrics`

Prometheus metrics.

---

## Output Format

Each crawled page is stored as:

```json
{
  "id": "uuid",
  "source_type": "web",
  "url": "https://example.com/page",
  "title": "Page Title",
  "content_markdown": "# Page Title\n\nContent...",
  "metadata": {
    "description": "...",
    "og_title": "...",
    "og_image": "...",
    "canonical": "...",
    "author": "..."
  },
  "links": ["https://example.com/other", "..."],
  "structured_data": {
    "json-ld": [{ "@type": "Article", ... }],
    "opengraph": [{ "og:title": "..." }]
  },
  "status_code": 200,
  "depth": 2,
  "screenshot_key": "crawls/job-id/hash.png",
  "timestamp": "2026-02-25T12:00:00Z"
}
```

---

## Kubernetes Deployment

```bash
# Apply all manifests
kubectl apply -f k8s/

# Or individually
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/ingress.yaml

# Scale workers
kubectl scale deployment krawler-worker --replicas=10 -n krawler

# Check HPA
kubectl get hpa -n krawler
```

Build and push images:
```bash
docker build -t your-registry/krawler-api:latest    ./backend
docker build -t your-registry/krawler-worker:latest ./backend -f ./backend/Dockerfile.worker
docker build -t your-registry/krawler-frontend:latest ./frontend

docker push your-registry/krawler-api:latest
docker push your-registry/krawler-worker:latest
docker push your-registry/krawler-frontend:latest
```

Update `k8s/api-deployment.yaml` and `k8s/worker-deployment.yaml` with your registry image paths.

---

## Project Structure

```
krawler/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + lifespan
│   │   ├── config.py            # Settings (pydantic-settings)
│   │   ├── models/
│   │   │   ├── crawl.py         # SQLAlchemy ORM models
│   │   │   └── schemas.py       # Pydantic request/response schemas
│   │   ├── core/
│   │   │   ├── database.py      # Async SQLAlchemy engine + session
│   │   │   ├── redis.py         # Redis pool + arq pool + key builders
│   │   │   └── storage.py       # S3/MinIO client
│   │   ├── api/routes/
│   │   │   ├── crawl.py         # POST /crawl, GET /status, GET /result
│   │   │   └── health.py        # GET /health, GET /metrics
│   │   ├── services/
│   │   │   ├── crawl_service.py # Job CRUD + arq enqueue
│   │   │   └── ios_scraper.py   # iTunes API + reviews scraper
│   │   └── utils/
│   │       ├── content.py       # HTML→Markdown, metadata, structured data
│   │       ├── robots.py        # robots.txt async parser
│   │       ├── url.py           # URL normalization, dedup, filtering
│   │       └── logging.py       # structlog configuration
│   ├── worker/
│   │   ├── main.py              # arq WorkerSettings + crawl_job task
│   │   ├── crawler.py           # BFS orchestrator (web + iOS modes)
│   │   ├── fetcher.py           # httpx + Playwright, auto-detect, retry
│   │   ├── extractor.py         # Full extraction pipeline
│   │   ├── anti_bot.py          # UA rotation, rate limiting, stealth
│   │   └── metrics.py           # Prometheus counters/histograms
│   ├── migrations/
│   │   └── init.sql             # Schema DDL
│   ├── Dockerfile               # API image
│   ├── Dockerfile.worker        # Worker image (includes Playwright)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout + providers
│       │   ├── page.tsx          # Dashboard
│       │   ├── crawl/[id]/       # Job detail + result viewer
│       │   └── history/          # Full history table
│       ├── components/
│       │   ├── CrawlForm.tsx     # Crawl job submission form
│       │   ├── ResultViewer.tsx  # Markdown/JSON/Links/Metadata tabs
│       │   ├── HistoryTable.tsx  # Jobs table with cancel
│       │   ├── StatusBadge.tsx   # Colored status pill
│       │   └── StatsCard.tsx     # Metric cards
│       ├── hooks/useCrawl.ts     # Submit + polling hooks
│       └── lib/
│           ├── api.ts            # Axios API client
│           └── types.ts          # TypeScript types
├── k8s/                          # Kubernetes manifests
├── docker-compose.yml
└── README.md
```

---

## Observability

| Metric | Description |
|--------|-------------|
| `krawler_crawl_urls_total` | Total URLs processed, by status |
| `krawler_crawl_jobs_total` | Total jobs, by status |
| `krawler_crawl_duration_seconds` | Per-page fetch duration histogram |
| `krawler_job_duration_seconds` | End-to-end job duration histogram |
| `krawler_active_workers` | Currently active workers gauge |
| `krawler_frontier_size` | URL frontier size per job |
| `krawler_cloudflare_blocks_total` | Cloudflare blocks detected |
| `krawler_captcha_detections_total` | CAPTCHAs encountered |

All components emit structured JSON logs compatible with any log aggregation system (Loki, Datadog, CloudWatch).
