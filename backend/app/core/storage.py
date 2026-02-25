from __future__ import annotations

import io
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from app.config import settings
from app.utils.logging import get_logger

log = get_logger(__name__)

_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        kwargs: dict = dict(
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
        )
        if settings.S3_ENDPOINT_URL:
            kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def ensure_bucket() -> None:
    client = _get_client()
    try:
        client.head_bucket(Bucket=settings.S3_BUCKET)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("404", "NoSuchBucket"):
            client.create_bucket(Bucket=settings.S3_BUCKET)
            log.info("Created S3 bucket", bucket=settings.S3_BUCKET)
        else:
            raise


def upload_bytes(
    key: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes to S3 and return the key."""
    _get_client().put_object(
        Bucket=settings.S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def upload_text(key: str, text: str, content_type: str = "text/html; charset=utf-8") -> str:
    return upload_bytes(key, text.encode("utf-8"), content_type)


def download_bytes(key: str) -> Optional[bytes]:
    try:
        resp = _get_client().get_object(Bucket=settings.S3_BUCKET, Key=key)
        return resp["Body"].read()
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise


def presigned_url(key: str, expires: int = 3600) -> str:
    return _get_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def delete_object(key: str) -> None:
    _get_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
