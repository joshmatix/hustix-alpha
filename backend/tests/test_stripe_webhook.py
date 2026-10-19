import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException

from routers.stripe_webhook import checkout_change, parse_event, plan_change_for_event, subscription_change

FIRM = "9c653cf6-c624-468a-b7bb-46b696df33d5"


def _sign(payload: bytes, secret: str) -> str:
    timestamp = int(time.time())
    signed = f"{timestamp}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_paid_checkout_selects_pro():
    change = checkout_change({
        "mode": "subscription",
        "payment_status": "paid",
        "client_reference_id": FIRM,
        "metadata": {"firm_id": FIRM, "plan": "pro"},
    })
    assert change == {"firm_id": FIRM, "plan": "pro", "status": "active"}


def test_unpaid_checkout_is_ignored():
    assert checkout_change({
        "mode": "subscription",
        "payment_status": "unpaid",
        "metadata": {"firm_id": FIRM, "plan": "pro_plus"},
    }) is None


def test_canceled_subscription_returns_the_firm_to_free():
    change = subscription_change({
        "status": "canceled",
        "metadata": {"firm_id": FIRM, "plan": "pro"},
    })
    assert change == {"firm_id": FIRM, "plan": "free", "status": "canceled"}


def test_deleted_subscription_returns_the_firm_to_free():
    event = {
        "type": "customer.subscription.deleted",
        "data": {"object": {"status": "canceled", "metadata": {"firm_id": FIRM, "plan": "pro_plus"}}},
    }
    assert plan_change_for_event(event)["plan"] == "free"


def test_active_subscription_keeps_the_paid_plan():
    change = subscription_change({
        "status": "active",
        "metadata": {"firm_id": FIRM, "plan": "pro_plus"},
    })
    assert change["plan"] == "pro_plus"
    assert change["status"] == "active"


def test_bad_signature_is_rejected(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    payload = json.dumps({"id": "evt_1"}).encode()
    with pytest.raises(HTTPException) as raised:
        parse_event(payload, _sign(payload, "whsec_other"))
    assert raised.value.status_code == 400


def test_valid_signature_parses(monkeypatch):
    secret = "whsec_test"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    payload = json.dumps({
        "id": "evt_1",
        "object": "event",
        "type": "checkout.session.completed",
        "data": {"object": {"id": "cs_1"}},
    }).encode()
    event = parse_event(payload, _sign(payload, secret))
    assert event["type"] == "checkout.session.completed"
