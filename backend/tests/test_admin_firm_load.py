import pytest

from admin_firm_load import (
    FIRM_PUBLIC_ID,
    JSON_TOO_LARGE_MESSAGE,
    MAX_LOAD_FIRM_JSON_BYTES,
    ensure_json_byte_limit,
    normalize_load_firm_payload,
)


def test_normalize_passes_through_firm_public_id():
    payload = {
        "firm_id": "firm_aBc123XyZ09",
        "advisors": [],
        "portfolios": [{"name": "Growth", "portfolio_id": "p1"}],
    }
    normalized = normalize_load_firm_payload(payload)
    assert normalized["firm_id"] == "firm_aBc123XyZ09"
    assert normalized["firm_name"] == ""
    assert normalized["advisors"] == []
    assert len(normalized["portfolios"]) == 1


def test_normalize_passes_through_firm_uuid():
    firm_uuid = "550e8400-e29b-41d4-a716-446655440000"
    normalized = normalize_load_firm_payload(
        {
            "firm_id": firm_uuid,
            "portfolios": [{"name": "Balanced", "portfolio_id": "p2"}],
            "advisors": [],
        }
    )
    assert normalized["firm_id"] == firm_uuid


def test_normalize_rejects_invalid_firm_id():
    with pytest.raises(ValueError, match="Invalid firm_id"):
        normalize_load_firm_payload(
            {
                "firm_id": "not-a-firm-id",
                "advisors": [{"email": "a@example.com"}],
            }
        )


def test_normalize_create_requires_name_and_advisor():
    with pytest.raises(ValueError, match="Firm name is required"):
        normalize_load_firm_payload({"advisors": [{"email": "a@example.com"}]})
    with pytest.raises(ValueError, match="Add at least one advisor"):
        normalize_load_firm_payload({"firm_name": "Acme", "advisors": []})


def test_normalize_append_requires_advisor_or_portfolio():
    with pytest.raises(ValueError, match="Add at least one advisor or portfolio"):
        normalize_load_firm_payload({"firm_id": "firm_aBc123XyZ09", "advisors": [], "portfolios": []})


def test_ensure_json_byte_limit():
    ensure_json_byte_limit(b"x" * MAX_LOAD_FIRM_JSON_BYTES)
    with pytest.raises(ValueError) as exc:
        ensure_json_byte_limit(b"x" * (MAX_LOAD_FIRM_JSON_BYTES + 1))
    assert exc.value.args[0] == JSON_TOO_LARGE_MESSAGE


def test_firm_public_id_pattern():
    assert FIRM_PUBLIC_ID.fullmatch("firm_aBc123XyZ09")
    assert not FIRM_PUBLIC_ID.fullmatch("firm_short")
    assert not FIRM_PUBLIC_ID.fullmatch("firm_aBc123XyZ09!")
