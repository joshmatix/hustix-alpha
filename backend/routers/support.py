"""Support address for a signed-in advisor, and the public question form.

Public pages do not include the address, so it is not sitting in the HTML
for scrapers. Questions from the homepage form are stored for the team.
"""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from database import supabase
from mailer import send_inquiry_email, smtp_target
from routers.portfolios import _require_user_id

router = APIRouter(prefix="/api/support", tags=["Support"])
log = logging.getLogger(__name__)

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HITS: dict[str, list[float]] = defaultdict(list)


class Inquiry(BaseModel):
    name: str = Field(max_length=120)
    email: str = Field(max_length=254)
    message: str = Field(max_length=4000)
    website: str = ""


def clean_inquiry(body: Inquiry) -> tuple[str, str, str] | None:
    name = " ".join(body.name.split())
    email = body.email.strip()
    message = body.message.strip()
    if not name or not message or not _EMAIL.match(email):
        return None
    return name, email, message


def inquiry_accepted(stored: bool, emailed: bool) -> bool:
    return stored or emailed


def _store_inquiry_file(name: str, email: str, message: str) -> None:
    bucket = "contact-inquiries"
    try:
        supabase.storage.create_bucket(bucket, options={"public": False})
    except Exception:
        pass
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    path = f"{stamp}-{uuid.uuid4().hex}.txt"
    body = f"Name: {name}\nEmail: {email}\n\n{message}\n"
    supabase.storage.from_(bucket).upload(
        path,
        body.encode(),
        file_options={"content-type": "text/plain"},
    )


def _store_inquiry(name: str, email: str, message: str) -> bool:
    if supabase is None:
        return False
    try:
        supabase.table("contact_inquiries").insert(
            {"name": name, "email": email, "message": message}
        ).execute()
        return True
    except Exception:
        log.exception("contact inquiry was not stored in the table")
    try:
        _store_inquiry_file(name, email, message)
        return True
    except Exception:
        log.exception("contact inquiry was not stored")
        return False


def _allow(ip: str) -> bool:
    now = time.monotonic()
    recent = [stamp for stamp in _HITS[ip] if now - stamp < 3600]
    if len(recent) >= 5:
        _HITS[ip] = recent
        return False
    recent.append(now)
    _HITS[ip] = recent
    return True


@router.get("/contact")
def contact(authorization: Optional[str] = Header(default=None)):
    _require_user_id(authorization)
    return {"email": os.getenv("SUPPORT_EMAIL", "support@hustix.com")}


@router.post("/inquiries")
def create_inquiry(body: Inquiry, request: Request):
    # A filled honeypot means a bot. Pretend it worked.
    if body.website.strip():
        return {"ok": True}

    cleaned = clean_inquiry(body)
    if cleaned is None:
        raise HTTPException(status_code=400, detail="Enter your name, a valid email, and a question.")

    ip = request.client.host if request.client else "unknown"
    if not _allow(ip):
        raise HTTPException(status_code=429, detail="Please wait before sending another question.")

    name, email, message = cleaned
    stored = _store_inquiry(name, email, message)
    emailed = False
    if smtp_target() is not None:
        try:
            send_inquiry_email(name, email, message)
            emailed = True
        except Exception:
            log.exception("contact inquiry email was not sent")
    if not inquiry_accepted(stored, emailed):
        raise HTTPException(status_code=503, detail="Questions cannot be sent right now.")
    return {"ok": True, "emailed": emailed}
