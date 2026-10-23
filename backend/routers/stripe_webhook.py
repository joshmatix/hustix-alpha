"""Stripe subscription webhook.

Checkout records firm_id and plan on the session. This route verifies
Stripe's signature and writes that plan onto the firm. Unsigned bodies
are rejected.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID

import stripe
from fastapi import APIRouter, HTTPException, Request

from database import SUPABASE_KEY, supabase, _bypasses_rls

router = APIRouter(prefix="/api/stripe", tags=["Stripe"])

PAID_PLANS = {"pro", "pro_plus"}
ENDED_STATUSES = {"canceled", "unpaid", "incomplete_expired", "past_due", "paused"}


def _uuid(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def checkout_change(session: dict) -> dict | None:
    if session.get("mode") != "subscription":
        return None
    if session.get("payment_status") not in {"paid", "no_payment_required"}:
        return None
    metadata = session.get("metadata") or {}
    firm_id = _uuid(metadata.get("firm_id") or session.get("client_reference_id"))
    plan = metadata.get("plan")
    if firm_id is None or plan not in PAID_PLANS:
        return None
    return {"firm_id": firm_id, "plan": plan, "status": "active"}


def subscription_change(subscription: dict, deleted: bool = False) -> dict | None:
    metadata = subscription.get("metadata") or {}
    firm_id = _uuid(metadata.get("firm_id"))
    if firm_id is None:
        return None
    status = subscription.get("status")
    if deleted or status in ENDED_STATUSES:
        return {"firm_id": firm_id, "plan": "free", "status": "canceled"}
    if status in {"active", "trialing"}:
        plan = metadata.get("plan")
        if plan not in PAID_PLANS:
            return None
        return {"firm_id": firm_id, "plan": plan, "status": "active"}
    return None


def parse_event(payload: bytes, signature: str | None) -> dict:
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Set STRIPE_WEBHOOK_SECRET on the server.")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature.")
    try:
        event = stripe.Webhook.construct_event(payload, signature, secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid payload.") from exc
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature.") from exc
    return event.to_dict() if hasattr(event, "to_dict") else dict(event)


def plan_change_for_event(event: dict) -> dict | None:
    kind = event.get("type")
    data = event.get("data") or {}
    obj = data.get("object") or {}
    if kind == "checkout.session.completed":
        return checkout_change(obj)
    if kind == "customer.subscription.updated":
        return subscription_change(obj)
    if kind == "customer.subscription.deleted":
        return subscription_change(obj, deleted=True)
    return None


def apply_plan_change(change: dict) -> bool:
    if supabase is None or not _bypasses_rls(SUPABASE_KEY):
        raise HTTPException(
            status_code=503,
            detail="Set SUPABASE_SERVICE_ROLE_KEY to this project's service role key.",
        )
    firm_id = change["firm_id"]
    found = supabase.table("subscriptions").select("firm_id").eq("firm_id", firm_id).limit(1).execute()
    if not found.data:
        print(f"[stripe] no subscription row for firm {firm_id}")
        return False
    fields = {
        # Phase 1 keeps every firm on Pro+ even when Stripe reports another plan.
        "plan_code": "pro_plus",
        "status": change["status"],
        "ends_at": None if change["status"] == "active" else datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("subscriptions").update(fields).eq("firm_id", firm_id).execute()
    supabase.rpc("mirror_firm_plan", {"target_firm": firm_id}).execute()
    return True


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    event = parse_event(payload, request.headers.get("stripe-signature"))
    change = plan_change_for_event(event)
    if change is None:
        return {"received": True, "applied": False}
    try:
        applied = apply_plan_change(change)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[stripe] plan update failed: {exc}")
        raise HTTPException(status_code=500, detail="Could not update the firm plan.") from exc
    return {"received": True, "applied": applied}
