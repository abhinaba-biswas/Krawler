from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import crawl, health
from app.config import settings
from app.core.database import dispose_db, init_db
from app.core.redis import close_arq_pool, close_redis
from app.core.storage import ensure_bucket
from app.utils.logging import configure_logging, get_logger

configure_logging(debug=settings.DEBUG)
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Krawler API", version=settings.APP_VERSION)
    await init_db()
    try:
        ensure_bucket()
    except Exception as e:
        log.warning("S3 bucket init failed (non-fatal)", error=str(e))
    yield
    log.info("Shutting down Krawler API")
    await close_arq_pool()
    await close_redis()
    await dispose_db()


app = FastAPI(
    title="Krawler",
    version=settings.APP_VERSION,
    description="Production-grade distributed web crawling & data extraction platform",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Middleware ─────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    if settings.API_KEY and request.url.path.startswith("/api"):
        key = request.headers.get("X-API-Key")
        if key != settings.API_KEY:
            return JSONResponse(status_code=401, content={"detail": "Invalid API key"})
    return await call_next(request)


# ── Routes ─────────────────────────────────────────────────────────────────────

app.include_router(health.router)
app.include_router(crawl.router)


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "docs": "/docs"}
