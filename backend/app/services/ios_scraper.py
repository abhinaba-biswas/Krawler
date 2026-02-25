from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

from app.models.schemas import AppStoreResult, AppStoreReview
from app.utils.logging import get_logger

log = get_logger(__name__)

_APP_ID_RE = re.compile(r"/id(\d+)")
_ITUNES_LOOKUP = "https://itunes.apple.com/lookup"
_REVIEWS_RSS = "https://itunes.apple.com/rss/customerreviews/page={page}/id={app_id}/sortBy=mostRecent/json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_app_id(url: str) -> Optional[str]:
    m = _APP_ID_RE.search(url)
    return m.group(1) if m else None


async def scrape_app_store(url: str, fetch_reviews_pages: int = 3) -> AppStoreResult:
    app_id = _parse_app_id(url)
    if not app_id:
        raise ValueError(f"Cannot extract app ID from URL: {url}")

    async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        app_data = await _fetch_itunes_data(client, app_id)
        reviews = await _fetch_reviews(client, app_id, pages=fetch_reviews_pages)

    result = AppStoreResult(
        id=str(uuid4()),
        url=url,
        app_id=app_id,
        name=app_data.get("trackName", ""),
        developer=app_data.get("artistName", ""),
        developer_id=str(app_data.get("artistId", "")),
        category=app_data.get("primaryGenreName"),
        rating=app_data.get("averageUserRating"),
        rating_count=app_data.get("userRatingCount"),
        version=app_data.get("version"),
        description=app_data.get("description"),
        release_date=app_data.get("releaseDate"),
        updated_date=app_data.get("currentVersionReleaseDate"),
        price=_format_price(app_data),
        in_app_purchases=bool(app_data.get("isVppDeviceBasedLicensingEnabled"))
        or "inAppPurchase" in (app_data.get("features") or []),
        in_app_purchase_details=app_data.get("formattedPrice"),
        screenshot_urls=_collect_screenshots(app_data),
        icon_url=app_data.get("artworkUrl512") or app_data.get("artworkUrl100"),
        supported_devices=app_data.get("supportedDevices") or [],
        languages=app_data.get("languageCodesISO2A") or [],
        size_bytes=app_data.get("fileSizeBytes") and int(app_data["fileSizeBytes"]),
        content_rating=app_data.get("contentAdvisoryRating"),
        reviews=reviews,
        metadata={
            "bundle_id": app_data.get("bundleId"),
            "minimum_os": app_data.get("minimumOsVersion"),
            "genres": app_data.get("genres"),
            "seller_name": app_data.get("sellerName"),
            "seller_url": app_data.get("sellerUrl"),
            "advisory_rating": app_data.get("contentAdvisoryRating"),
            "track_id": app_data.get("trackId"),
            "track_view_url": app_data.get("trackViewUrl"),
        },
        timestamp=datetime.now(timezone.utc),
    )
    log.info("iOS app scraped", app_id=app_id, name=result.name)
    return result


async def _fetch_itunes_data(client: httpx.AsyncClient, app_id: str) -> Dict[str, Any]:
    resp = await client.get(
        _ITUNES_LOOKUP,
        params={"id": app_id, "country": "us", "entity": "software"},
    )
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results", [])
    if not results:
        raise ValueError(f"App {app_id} not found in iTunes API")
    return results[0]


async def _fetch_reviews(
    client: httpx.AsyncClient, app_id: str, pages: int = 3
) -> List[AppStoreReview]:
    reviews: List[AppStoreReview] = []
    for page in range(1, pages + 1):
        url = _REVIEWS_RSS.format(page=page, app_id=app_id)
        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                break
            data = resp.json()
            entries = data.get("feed", {}).get("entry", [])
            if not entries:
                break
            for entry in entries:
                try:
                    reviews.append(_parse_review_entry(entry))
                except Exception as e:
                    log.debug("Failed to parse review entry", error=str(e))
        except Exception as e:
            log.warning("Failed to fetch reviews page", page=page, error=str(e))
            break
    return reviews


def _parse_review_entry(entry: Dict[str, Any]) -> AppStoreReview:
    def _label(field: str) -> str:
        v = entry.get(field, {})
        return v.get("label", "") if isinstance(v, dict) else str(v)

    return AppStoreReview(
        id=_label("id"),
        author=entry.get("author", {}).get("name", {}).get("label", ""),
        rating=int(_label("im:rating") or 0),
        title=_label("title"),
        body=_label("content"),
        date=_label("updated"),
        version=_label("im:version"),
    )


def _format_price(data: Dict[str, Any]) -> Optional[str]:
    price = data.get("price")
    currency = data.get("currency", "USD")
    if price == 0:
        return "Free"
    if price:
        return f"{currency} {price:.2f}"
    return None


def _collect_screenshots(data: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    for key in ("screenshotUrls", "ipadScreenshotUrls", "appletvScreenshotUrls"):
        urls.extend(data.get(key) or [])
    return urls
