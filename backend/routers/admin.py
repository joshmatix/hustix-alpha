"""Password-gated admin API for the hosted app.

Vercel runs the site, so this router does not start or stop processes.
It reads open advisor sessions and edits the plan caps on public.plans.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from admin_firm_load import normalize_load_firm_payload
from database import SUPABASE_KEY, SUPABASE_UNREACHABLE, _bypasses_rls, supabase

router = APIRouter(prefix="/api/admin", tags=["Admin"])

COOKIE = "hustix_admin"
MAX_AGE = 12 * 60 * 60
PLAN_CODES = ("free", "pro", "pro_plus", "enterprise")
FIRM_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_failures: dict[str, list[float]] = {}


class PlanLimit(BaseModel):
    code: str
    portfolio_limit: int | None = None
    ticker_limit: int | None = None


class LimitsBody(BaseModel):
    plans: list[PlanLimit] = Field(default_factory=list)


class LoginBody(BaseModel):
    password: str = ""


class AdvisorAccessBody(BaseModel):
    user_id: str
    enabled: bool


class FirmAccessBody(BaseModel):
    firm_id: str
    enabled: bool


class AdvisorPlanBody(BaseModel):
    user_id: str
    plan_code: str


class AdvisorPromotionBody(BaseModel):
    user_id: str
    codes: list[str] = Field(default_factory=list)


class AdvisorContactBody(BaseModel):
    user_id: str
    full_name: str = ""
    firm_name: str = ""
    phone: str = ""


class PromotionBody(BaseModel):
    code: str = ""
    percent_off: int | None = None
    amount_off_cents: int | None = None
    applies_to: list[str] = Field(default_factory=list)
    starts_on: str = ""
    ends_on: str = ""


class HoldingsClassificationBody(BaseModel):
    source: str = ""


def _parse_firm_id(value: str) -> str:
    if not FIRM_ID.fullmatch(value or ""):
        raise HTTPException(status_code=422, detail="Invalid firm id.")
    return value.lower()


def _rpc_json(name: str, params: dict | None = None) -> object:
    result = supabase.rpc(name, params or {}).execute()
    data = result.data
    if isinstance(data, str):
        return json.loads(data or "null")
    return data


def _read_firms() -> list[dict]:
    try:
        data = _rpc_json("admin_firms_list")
    except Exception as exc:
        print(f"[admin] firm list failed: {exc}")
        raise HTTPException(
            status_code=503,
            detail="Run supabase/migrations/admin_firm_read.sql on this database, then refresh.",
        ) from exc
    if not isinstance(data, list):
        return []
    return data


def _read_firm_detail(firm_id: str) -> dict | None:
    fid = _parse_firm_id(firm_id)
    try:
        data = _rpc_json("admin_firm_detail", {"target_firm": fid})
    except Exception as exc:
        print(f"[admin] firm detail failed: {exc}")
        raise HTTPException(status_code=503, detail="Could not read firm.") from exc
    if not isinstance(data, dict):
        return None
    return data


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


def _rpc_message(exc: Exception) -> str:
    text = str(exc)
    match = re.search(r"""["']message["']\s*:\s*["']([^"']+)["']""", text)
    if match:
        return match.group(1)
    return "Could not update the advisor."


def _directory_payload(data: object) -> dict:
    if isinstance(data, str):
        data = json.loads(data or "{}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=503, detail="Could not read advisors.")
    advisors = data.get("advisors")
    promotions = data.get("promotions")
    return {
        "advisors": advisors if isinstance(advisors, list) else [],
        "promotions": promotions if isinstance(promotions, list) else [],
    }


def _read_directory() -> tuple[dict, str | None]:
    try:
        result = supabase.rpc("admin_directory").execute()
    except Exception as exc:
        print(f"[admin] advisor list failed: {exc}")
        return {"advisors": [], "promotions": []}, "Run supabase/migrations/admin_advisors.sql on this database, then refresh."
    try:
        return _directory_payload(result.data), None
    except HTTPException:
        return {"advisors": [], "promotions": []}, "Could not read advisors."


def _mutate_directory(name: str, params: dict) -> dict:
    try:
        result = supabase.rpc(name, params).execute()
    except Exception as exc:
        print(f"[admin] {name} failed: {exc}")
        raise HTTPException(status_code=400, detail=_rpc_message(exc)) from exc
    return _directory_payload(result.data)


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
    directory, advisors_error = _read_directory()
    return {
        "plans": plans,
        "accounts": accounts,
        "accounts_error": accounts_error,
        "advisors": directory["advisors"],
        "promotions": directory["promotions"],
        "advisors_error": advisors_error,
    }


@router.post("/advisors/access")
def advisor_access(body: AdvisorAccessBody, request: Request):
    _require_admin(request)
    _require_database()
    return _mutate_directory("admin_set_advisor_access", {"target_user": body.user_id, "enabled": body.enabled})


@router.post("/firms/access")
def firm_access(body: FirmAccessBody, request: Request):
    _require_admin(request)
    _require_database()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database is not configured.")
    try:
        supabase.rpc(
            "admin_set_firm_access",
            {"target_firm": body.firm_id, "enabled": body.enabled},
        ).execute()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/firms")
def firms_list(request: Request):
    _require_admin(request)
    _require_database()
    return {"firms": _read_firms()}


@router.get("/firms/{firm_id}")
def firm_detail(firm_id: str, request: Request):
    _require_admin(request)
    _require_database()
    detail = _read_firm_detail(firm_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Firm not found.")
    return detail


@router.post("/firms/load")
async def load_firm(request: Request):
    _require_admin(request)
    _require_database()
    try:
        raw = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON.") from exc
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="Invalid request.")
    try:
        normalized = normalize_load_firm_payload(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        result = supabase.rpc("admin_load_firm", {"payload": normalized}).execute()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=_rpc_message(exc)) from exc
    data = result.data
    if isinstance(data, str):
        data = json.loads(data or "{}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=503, detail="Firm was not created.")
    firm_id = data.get("firm_id")
    if not firm_id:
        raise HTTPException(status_code=503, detail="Firm was not created.")
    detail = _read_firm_detail(str(firm_id))
    if detail is None:
        raise HTTPException(status_code=503, detail="Firm was created but could not be loaded.")
    return {
        "ok": True,
        "firm_id": firm_id,
        "firm": detail,
        "firms": _read_firms(),
        "invited_count": data.get("invited_count") or len(data.get("invited_emails") or []),
    }


@router.post("/firms/{firm_id}/holdings-classification")
def firm_holdings_classification(firm_id: str, body: HoldingsClassificationBody, request: Request):
    _require_admin(request)
    _require_database()
    fid = _parse_firm_id(firm_id)
    source = str(body.source or "").strip().lower()
    if source not in {"csv", "authoritative"}:
        raise HTTPException(status_code=422, detail="Source must be csv or authoritative.")
    try:
        supabase.table("firms").update({"holdings_classification_source": source}).eq("id", fid).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not update classification source.") from exc
    detail = _read_firm_detail(fid)
    if detail is None:
        raise HTTPException(status_code=404, detail="Firm not found.")
    return {"ok": True, "firm": detail}


@router.post("/advisors/plan")
def advisor_plan(body: AdvisorPlanBody, request: Request):
    _require_admin(request)
    _require_database()
    if body.plan_code not in PLAN_CODES:
        raise HTTPException(status_code=422, detail="Unknown plan.")
    return _mutate_directory("admin_set_advisor_plan", {"target_user": body.user_id, "target_plan": body.plan_code})


@router.post("/advisors/promotion")
def advisor_promotion(body: AdvisorPromotionBody, request: Request):
    _require_admin(request)
    _require_database()
    codes = [code.strip() for code in body.codes if code.strip()]
    return _mutate_directory(
        "admin_set_advisor_promotions",
        {"target_user": body.user_id, "promo_codes": codes},
    )


@router.post("/advisors/contact")
def advisor_contact(body: AdvisorContactBody, request: Request):
    _require_admin(request)
    _require_database()
    return _mutate_directory(
        "admin_update_advisor_contact",
        {
            "target_user": body.user_id,
            "next_name": body.full_name,
            "next_firm": body.firm_name,
            "next_phone": body.phone,
        },
    )


@router.post("/promotions")
def save_promotion(body: PromotionBody, request: Request):
    _require_admin(request)
    _require_database()
    if (body.percent_off is None) == (body.amount_off_cents is None):
        raise HTTPException(status_code=422, detail="Set a percent off or an amount off.")
    applies = [code for code in body.applies_to if code in PLAN_CODES]
    if not applies:
        raise HTTPException(status_code=422, detail="Choose at least one plan.")
    try:
        starts_on = date.fromisoformat(body.starts_on)
        expires_on = date.fromisoformat(body.ends_on)
    except ValueError:
        raise HTTPException(status_code=422, detail="Choose a start date and an end date.") from None
    today = datetime.now(timezone.utc).date()
    if starts_on < today:
        raise HTTPException(status_code=422, detail="The start date must be today or later.")
    if expires_on < starts_on:
        raise HTTPException(status_code=422, detail="The end date must be on or after the start date.")
    return _mutate_directory(
        "admin_upsert_promotion",
        {
            "promo_code": body.code,
            "promo_label": body.code,
            "percent_off": body.percent_off,
            "amount_off_cents": body.amount_off_cents,
            "applies_to": applies,
            "starts_on": starts_on.isoformat(),
            "expires_on": expires_on.isoformat(),
        },
    )


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
