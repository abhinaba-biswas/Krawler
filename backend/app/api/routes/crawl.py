from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.schemas import (
    CrawlJobResponse,
    CrawlRequest,
    CrawlResultsResponse,
    StatusResponse,
)
from app.services import crawl_service
from app.services.ios_scraper import scrape_app_store
from app.utils.logging import get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["crawl"])


# ── Crawl jobs ──────────────────────────────────────────────────────────────────

@router.post("/crawl", response_model=CrawlJobResponse, status_code=202)
async def create_crawl(req: CrawlRequest, db: AsyncSession = Depends(get_db)):
    """Submit a new crawl job."""
    try:
        job = await crawl_service.create_job(req, db)
        return job
    except Exception as e:
        log.error("Failed to create crawl job", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{crawl_id}", response_model=StatusResponse)
async def get_status(crawl_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get crawl job status."""
    status = await crawl_service.get_status(crawl_id, db)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/result/{crawl_id}", response_model=CrawlResultsResponse)
async def get_results(
    crawl_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Get crawl results for a job."""
    results = await crawl_service.get_results(crawl_id, db, limit=limit, offset=offset)
    if not results:
        raise HTTPException(status_code=404, detail="Job not found")
    return results


@router.get("/jobs", response_model=list[CrawlJobResponse])
async def list_jobs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List all crawl jobs."""
    return await crawl_service.list_jobs(db, limit=limit, offset=offset)


@router.post("/cancel/{crawl_id}")
async def cancel_job(crawl_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a running or queued crawl job."""
    success = await crawl_service.cancel_job(crawl_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found or not cancellable")
    return {"cancelled": True, "job_id": str(crawl_id)}


# ── Export ──────────────────────────────────────────────────────────────────────

_MIME = {
    "csv":     "text/csv",
    "xlsx":    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "numbers": "application/x-iwork-numbers-sffnumbers",
}


@router.get("/export/{crawl_id}")
async def export_results(
    crawl_id: UUID,
    format: str = Query("xlsx", pattern="^(csv|xlsx|numbers)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Download all crawl results as CSV, XLSX, or Apple Numbers.
    Columns: name | hall | stand | website | facebook | instagram | youtube
    """
    from app.services.export_service import export_job

    try:
        data = await export_job(crawl_id, format, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Export failed", job_id=str(crawl_id), fmt=format, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    filename = f"crawl_{str(crawl_id)[:8]}.{format}"
    return Response(
        content=data,
        media_type=_MIME[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── iOS scraper ─────────────────────────────────────────────────────────────────

@router.post("/scrape/ios")
async def scrape_ios(url: str = Query(..., description="Apple App Store URL")):
    """
    Quick synchronous iOS App Store scrape (no job queue).
    For large-scale use, submit via POST /api/crawl with mode=ios_app.
    """
    try:
        result = await scrape_app_store(url)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("iOS scrape failed", url=url, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
