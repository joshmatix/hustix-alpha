"""Normalize load-firm JSON for admin_load_firm RPC (shared shape with admin/server.py)."""

from __future__ import annotations


def normalize_load_firm_payload(payload: dict) -> dict:
    firm_name = str(payload.get("firm_name") or payload.get("firm") or "").strip()
    plan_code = str(payload.get("plan_code") or "pro_plus").strip() or "pro_plus"
    advisors_in = payload.get("advisors")
    portfolios_in = payload.get("portfolios")
    if not isinstance(advisors_in, list):
        raise ValueError("Advisors must be an array.")
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
    return {
        "firm": firm_name,
        "firm_name": firm_name,
        "plan_code": plan_code,
        "advisors": advisors,
        "portfolios": portfolios,
    }
