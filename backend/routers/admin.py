"""Password-gated admin API for the hosted app.

Vercel runs the site, so this router does not start or stop processes.
It reads open advisor sessions and edits the plan caps on public.plans.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from database import SUPABASE_KEY, SUPABASE_UNREACHABLE, _bypasses_rls, supabase

router = APIRouter(prefix="/api/admin", tags=["Admin"])

COOKIE = "hustix_admin"
MAX_AGE = 12 * 60 * 60
PLAN_CODES = ("free", "pro", "pro_plus", "enterprise")
_failures: dict[str, list[float]] = {}


class PlanLimit(BaseModel):
    code: str
    portfolio_limit: int | None = None
    ticker_limit: int | None = None


class LimitsBody(BaseModel):
    plans: list[PlanLimit] = Field(default_factory=list)


class LoginBody(BaseModel):
    password: str = ""


def admin_password() -> str:
    configured = os.getenv("ADMIN_PASSWORD", "").strip()
    if configured:
        return configured
    if os.getenv("VERCEL") or os.getenv("VERCEL_ENV"):
        return ""
    env_path = Path(__file__).resolve().parents[2] / "admin" / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text().splitlines():
        if line.startswith("ADMIN_PASSWORD="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def sign_session(secret: str, expiry: int) -> str:
    message = str(expiry).encode()
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"{expiry}.{signature}"


def session_valid(secret: str, token: str, now: int | None = None) -> bool:
    if not secret or "." not in token:
        return False
    expiry_text, signature = token.split(".", 1)
    if not expiry_text.isdigit():
        return False
    expiry = int(expiry_text)
    if expiry <= (time.time() if now is None else now):
        return False
    expected = hmac.new(secret.encode(), expiry_text.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def _secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.split(",")[0].strip() == "https"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def _too_many_failures(ip: str) -> bool:
    cutoff = time.time() - 60
    recent = [stamp for stamp in _failures.get(ip, []) if stamp >= cutoff]
    _failures[ip] = recent
    return len(recent) >= 8


def _signed_in(request: Request) -> bool:
    return session_valid(admin_password(), request.cookies.get(COOKIE, ""))


def _require_admin(request: Request) -> None:
    if not _signed_in(request):
        raise HTTPException(status_code=401, detail="Sign in required.")


def _require_database() -> None:
    if SUPABASE_UNREACHABLE or supabase is None:
        raise HTTPException(status_code=503, detail=SUPABASE_UNREACHABLE or "Database is not configured.")
    if not _bypasses_rls(SUPABASE_KEY):
        raise HTTPException(
            status_code=503,
            detail="Set SUPABASE_SERVICE_ROLE_KEY to this project's service role key.",
        )


def _parse_limit(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 0 or value > 1_000_000:
        raise HTTPException(status_code=422, detail="A limit must be between 0 and 1000000, or empty for no cap.")
    return value


def _plan_read_error(exc: Exception) -> str:
    text = str(exc).lower()
    if "does not exist" in text or "42p01" in text or "pgrst205" in text:
        return "The plans table is not on this database. Run the subscription SQL first."
    if "permission" in text or "42501" in text or "pgrst301" in text:
        return "The API cannot read plans. Set SUPABASE_SERVICE_ROLE_KEY for this project."
    return "Could not read plans."


def _read_plans() -> list[dict]:
    result = supabase.table("plans").select("code,name,monthly_cents,portfolio_limit,ticker_limit").execute()
    rows = result.data or []
    order = {code: index for index, code in enumerate(PLAN_CODES)}
    rows.sort(key=lambda row: (order.get(row.get("code"), 99), row.get("code") or ""))
    return rows


def _read_accounts() -> tuple[list, str | None]:
    try:
        result = supabase.rpc("admin_open_accounts").execute()
    except Exception as exc:
        print(f"[admin] account list failed: {exc}")
        return [], "Run supabase/migrations/admin_cloud.sql on this database, then refresh."
    data = result.data
    if isinstance(data, str):
        import json
        data = json.loads(data or "[]")
    if not isinstance(data, list):
        return [], "Could not read signed-in accounts."
    return data, None


def _cookie(response: JSONResponse, request: Request, token: str | None) -> None:
    if token is None:
        response.delete_cookie(COOKIE, path="/", secure=_secure(request), httponly=True, samesite="lax")
        return
    response.set_cookie(
        COOKIE,
        token,
        max_age=MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_secure(request),
        path="/",
    )


@router.get("/session")
def session(request: Request):
    return {"signed_in": _signed_in(request)}


@router.post("/login")
def login(body: LoginBody, request: Request):
    secret = admin_password()
    if not secret:
        raise HTTPException(status_code=503, detail="Set ADMIN_PASSWORD on the server.")
    ip = _client_ip(request)
    if _too_many_failures(ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
    if not hmac.compare_digest(body.password, secret):
        _failures.setdefault(ip, []).append(time.time())
        raise HTTPException(status_code=401, detail="Wrong password.")
    response = JSONResponse({"ok": True})
    _cookie(response, request, sign_session(secret, int(time.time()) + MAX_AGE))
    return response


@router.post("/logout")
def logout(request: Request):
    response = JSONResponse({"ok": True})
    _cookie(response, request, None)
    return response


@router.get("/state")
def state(request: Request):
    _require_admin(request)
    _require_database()
    try:
        plans = _read_plans()
    except Exception as exc:
        print(f"[admin] plan list failed: {exc}")
        raise HTTPException(status_code=503, detail=_plan_read_error(exc)) from exc
    accounts, accounts_error = _read_accounts()
    return {"plans": plans, "accounts": accounts, "accounts_error": accounts_error}


@router.post("/limits")
def limits(body: LimitsBody, request: Request):
    _require_admin(request)
    _require_database()
    seen: set[str] = set()
    updates: list[tuple[str, int | None, int | None]] = []
    for row in body.plans:
        if row.code not in PLAN_CODES or row.code in seen:
            raise HTTPException(status_code=422, detail="Unknown plan.")
        seen.add(row.code)
        updates.append((row.code, _parse_limit(row.portfolio_limit), _parse_limit(row.ticker_limit)))
    if seen != set(PLAN_CODES):
        raise HTTPException(status_code=422, detail="Save every plan together.")
    try:
        for code, portfolio_limit, ticker_limit in updates:
            supabase.table("plans").update(
                {"portfolio_limit": portfolio_limit, "ticker_limit": ticker_limit}
            ).eq("code", code).execute()
        plans = _read_plans()
    except Exception as exc:
        print(f"[admin] limit save failed: {exc}")
        raise HTTPException(status_code=503, detail="Could not save limits.") from exc
    return {"plans": plans}
