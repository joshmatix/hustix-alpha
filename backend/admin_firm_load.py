"""Normalize load-firm JSON for admin_load_firm RPC (shared shape with admin/server.py)."""

from __future__ import annotations

import json
import re

from fastapi import HTTPException, Request

MAX_LOAD_FIRM_JSON_BYTES = 3 * 1024 * 1024
JSON_TOO_LARGE_MESSAGE = "Load-firm JSON is too large (max 3 MB)."
_READ_CHUNK_BYTES = 64 * 1024

FIRM_PUBLIC_ID = re.compile(r"^firm_[a-zA-Z0-9]{11}$")
FIRM_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def ensure_json_byte_limit(contents: bytes) -> None:
    if len(contents) > MAX_LOAD_FIRM_JSON_BYTES:
        raise ValueError(JSON_TOO_LARGE_MESSAGE)


async def read_bounded_json(request: Request) -> dict:
    """Read a JSON body without buffering more than MAX_LOAD_FIRM_JSON_BYTES."""
    raw_length = request.headers.get("content-length")
    if raw_length is not None:
        try:
            declared = int(raw_length)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid request.") from exc
        if declared > MAX_LOAD_FIRM_JSON_BYTES:
            raise HTTPException(status_code=413, detail=JSON_TOO_LARGE_MESSAGE)

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_LOAD_FIRM_JSON_BYTES:
            raise HTTPException(status_code=413, detail=JSON_TOO_LARGE_MESSAGE)
        chunks.append(chunk)

    raw = b"".join(chunks)
    if not raw:
        return {}
    ensure_json_byte_limit(raw)
    try:
        parsed = json.loads(raw.decode())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="Invalid request.")
    return parsed


def normalize_load_firm_payload(payload: dict) -> dict:
    firm_id_raw = str(payload.get("firm_id") or "").strip()
    append_mode = bool(firm_id_raw)
    if append_mode and not (FIRM_PUBLIC_ID.fullmatch(firm_id_raw) or FIRM_UUID.fullmatch(firm_id_raw)):
        raise ValueError("Invalid firm_id.")

    firm_name = str(payload.get("firm_name") or payload.get("firm") or "").strip()
    plan_code = str(payload.get("plan_code") or "pro_plus").strip() or "pro_plus"
    advisors_in = payload.get("advisors")
    portfolios_in = payload.get("portfolios")
    if not isinstance(advisors_in, list):
        raise ValueError("Advisors must be an array.")
    if not append_mode and not firm_name:
        raise ValueError("Firm name is required.")
    if not append_mode and len(advisors_in) == 0:
        raise ValueError("Add at least one advisor.")

    advisors: list[dict] = []
    seen_emails: set[str] = set()
    for row in advisors_in:
        if not isinstance(row, dict):
            raise ValueError("Each advisor must be an object.")
        email = str(row.get("email") or row.get("advisor_email") or "").strip().lower()
        full_name = str(row.get("full_name") or row.get("advisor_name") or "").strip()
        role = str(row.get("role") or "advisor").strip() or "advisor"
        portfolio_ids = row.get("portfolio_ids") or []
        if not isinstance(portfolio_ids, list):
            raise ValueError("portfolio_ids must be an array.")
        lead_ids = row.get("lead_portfolio_ids") or []
        if lead_ids and not isinstance(lead_ids, list):
            raise ValueError("lead_portfolio_ids must be an array.")
        if email in seen_emails:
            for existing in advisors:
                if existing["email"] == email:
                    merged = list(existing["portfolio_ids"])
                    for pid in portfolio_ids:
                        if pid not in merged:
                            merged.append(pid)
                    existing["portfolio_ids"] = merged
                    if role == "owner":
                        existing["role"] = "owner"
                    if full_name and not existing["full_name"]:
                        existing["full_name"] = full_name
                        existing["advisor_name"] = full_name
                    break
            continue
        seen_emails.add(email)
        advisors.append(
            {
                "email": email,
                "advisor_email": email,
                "full_name": full_name,
                "advisor_name": full_name,
                "role": role,
                "portfolio_ids": portfolio_ids,
                "lead_portfolio_ids": lead_ids if isinstance(lead_ids, list) else [],
            }
        )
    portfolios: list[dict] = []
    if isinstance(portfolios_in, list):
        for row in portfolios_in:
            if not isinstance(row, dict):
                raise ValueError("Each portfolio must be an object.")
            name = str(row.get("name") or row.get("portfolio_name") or "").strip()
            portfolio_id = row.get("portfolio_id", row.get("import_id", ""))
            portfolios.append(
                {
                    "name": name,
                    "portfolio_name": name,
                    "portfolio_id": portfolio_id,
                    "account_number": str(row.get("account_number") or "").strip(),
                    "sub_account_number": str(row.get("sub_account_number") or "").strip(),
                    "portfolio_value": row.get("portfolio_value", 0),
                    "advisor_emails": row.get("advisor_emails") or [],
                    "description": row.get("description") or "",
                    "target_risk_profile": row.get("target_risk_profile") or "Balanced",
                    "asset_allocation": row.get("asset_allocation"),
                }
            )
    elif portfolios_in is not None and not isinstance(portfolios_in, list):
        raise ValueError("Portfolios must be an array.")

    if append_mode and len(advisors) == 0 and len(portfolios) == 0:
        raise ValueError("Add at least one advisor or portfolio.")

    normalized: dict = {
        "firm": firm_name,
        "firm_name": firm_name,
        "plan_code": plan_code,
        "advisors": advisors,
        "portfolios": portfolios,
    }
    if firm_id_raw:
        normalized["firm_id"] = firm_id_raw
    return normalized
