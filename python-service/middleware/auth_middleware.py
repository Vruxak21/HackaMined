"""
HMAC-SHA256 request signature verification for internal Next.js → Python requests.

Used as a FastAPI dependency on protected endpoints.  Validates:
  1. Both x-service-signature and x-service-timestamp headers are present.
  2. The request timestamp is within MAX_AGE_SECONDS of server time.
  3. The HMAC-SHA256 signature over "<timestamp_ms>.<body>" matches.

Set INTERNAL_SERVICE_SECRET (64 hex chars) in python-service/.env.
Leave unset to disable enforcement (local development without a shared secret).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

from fastapi import HTTPException, Request

SECRET: str = os.environ.get("INTERNAL_SERVICE_SECRET", "")
MAX_AGE_SECONDS: int = 30


async def verify_service_signature(request: Request) -> None:
    """FastAPI dependency that enforces HMAC-signed request authentication."""

    # Enforcement is opt-in: skip when secret is not configured (local dev).
    if not SECRET:
        return

    # Step 1: Get headers
    signature = request.headers.get("x-service-signature")
    timestamp = request.headers.get("x-service-timestamp")

    if not signature or not timestamp:
        raise HTTPException(status_code=401, detail="Missing service auth headers")

    # Step 2: Check timestamp freshness
    try:
        request_time = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid timestamp")

    current_time = int(time.time() * 1000)
    age_seconds = (current_time - request_time) / 1000

    if age_seconds > MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Request expired")

    if age_seconds < -5:
        raise HTTPException(status_code=401, detail="Request from future")

    # Step 3: Reconstruct payload
    body = await request.body()
    payload = timestamp + "." + body.decode("utf-8")

    # Step 4: Verify signature
    try:
        key = bytes.fromhex(SECRET)
    except ValueError:
        raise HTTPException(status_code=500, detail="Server misconfiguration: invalid secret format")

    expected = hmac.new(
        key,
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    # Constant-time comparison prevents timing side-channel attacks
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
