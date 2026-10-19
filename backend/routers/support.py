"""Support address for a signed-in advisor, and the public question form.

Public pages do not include the address, so it is not sitting in the HTML
for scrapers. Questions from the homepage form are stored for the team.
"""

from __future__ import annotations

import os
import re
import time
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from database import supabase
from routers.portfolios import _require_user_id

router = APIRouter(prefix="/api/support", tags=["Support"])

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

    if supabase is None:
        raise HTTPException(status_code=503, detail="Questions cannot be sent right now.")

    name, email, message = cleaned
    try:
        supabase.table("contact_inquiries").insert(
            {"name": name, "email": email, "message": message}
        ).execute()
    except Exception:
        raise HTTPException(status_code=503, detail="Questions cannot be sent right now.")
    return {"ok": True}
