from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID

from engine.distribution import DISTRIBUTION_PARAMETERS, longevity_cone, run_distribution
from engine.live_risk import LiveRiskError, live_starting_value, run_all_scenarios, run_live_stress
from engine.output_formatter import format_analysis_output
from engine.report_pdf import build_stress_report

router = APIRouter(prefix="/api/v1", tags=["Simulation"])


class SimulationRequest(BaseModel):
    portfolio_id: UUID
    scenario: str = Field(default="Rate_Shock")
    portfolio_value: Optional[float] = None
    weights: Optional[dict] = None
    audience: str = Field(default="advisor")
    distribution_model: str = Field(default="student_t")
    macro_shock_bps: float = Field(default=200.0)
    simulations: int = Field(default=10000, ge=1000, le=50000)
    time_horizon_years: int = Field(default=5, ge=1, le=30)
    yield_bps: Optional[float] = Field(default=None, ge=-1000, le=1000)
    equity_pct: Optional[float] = Field(default=None, ge=-80, le=100)
    use_worst_equity_window: bool = False


class DistributionRequest(BaseModel):
    portfolio_id: UUID
    simulations: int = Field(default=10000, ge=1000, le=50000)
    time_horizon_years: int = Field(default=5, ge=1, le=30)
    distribution_model: str = Field(default="student_t")
    macro_shock_bps: float = Field(default=0.0)


def _cash_daily_return() -> float:
    try:
        from engine.macro_feeds import fetch_macro_indicators

        fed_funds = fetch_macro_indicators().get("Fed_Funds_Rate") or 0.0
        return float(fed_funds) / 100.0 / 252.0
    except Exception:
        return 0.0


@router.post("/simulate")
def run_stress_test(req: SimulationRequest, authorization: Optional[str] = Header(default=None)):
    from routers.portfolios import _require_assignments

    _, assigned, db = _require_assignments(authorization)
    if str(req.portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    holdings = (
        db.table("portfolio_holdings")
        .select("ticker,asset_class,quantity,current_price,duration_years")
        .eq("portfolio_id", str(req.portfolio_id))
        .execute()
    )
    try:
        result = run_live_stress(
            holdings.data or [],
            req.scenario,
            _cash_daily_return(),
            req.yield_bps,
            req.equity_pct,
            req.use_worst_equity_window,
        )
    except LiveRiskError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live market data request failed: {exc}") from exc

    simulation_results = {
        "baseline_value": result["baseline_value"],
        "mean_shocked_value": result["mean_shocked_value"],
        "var_95_loss": result["var_95_loss"],
        "history_days": result["history_days"],
        "cash_note": result.get("cash_note") or "",
        "status": "completed",
    }
    formatted = format_analysis_output(
        simulation_results,
        result.get("shock_label") or result["scenario"],
    )
    return {
        **simulation_results,
        "scenario": result["scenario"],
        "shock_label": result.get("shock_label") or "",
        "yield_shock": result["yield_shock"],
        "growth_shock": result["growth_shock"],
        "overall_score": result["overall_score"],
        "asset_impacts": result["asset_impacts"],
        "class_values": result["class_values"],
        "fallback_holdings": result["fallback_holdings"],
        "fallback_note": result["fallback_note"],
        "scenario_days": result["scenario_days"],
        "paths": result["paths"],
        "data_mode": "live",
        "narrative": formatted["client_narrative"],
        "metrics": formatted["metrics"],
    }


@router.post("/distribution-simulate")
def run_distribution_simulation(
    req: DistributionRequest,
    authorization: Optional[str] = Header(default=None),
):
    from routers.portfolios import _require_assignments

    _, assigned, db = _require_assignments(authorization)
    if str(req.portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    holdings = (
        db.table("portfolio_holdings")
        .select("ticker,asset_class,quantity,current_price")
        .eq("portfolio_id", str(req.portfolio_id))
        .execute()
    )
    try:
        starting_value = live_starting_value(holdings.data or [])
        return run_distribution(
            starting_value,
            req.simulations,
            req.time_horizon_years,
            req.distribution_model,
            req.macro_shock_bps,
        )
    except LiveRiskError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live market data request failed: {exc}") from exc


def _report_identity(user_id: str, firm_id, db) -> tuple[str, str, dict]:
    profile = (
        db.table("profiles")
        .select("full_name,firm_name")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    row = (profile.data or [{}])[0]
    advisor_name = str(row.get("full_name") or "").strip()
    firm_name = str(row.get("firm_name") or "").strip()
    firm_header: dict = {}
    if firm_id:
        firm = (
            db.table("firms")
            .select("name,report_header")
            .eq("id", str(firm_id))
            .limit(1)
            .execute()
        )
        firm_row = (firm.data or [{}])[0]
        stored_name = str(firm_row.get("name") or "").strip()
        if stored_name:
            firm_name = stored_name
        stored_header = firm_row.get("report_header")
        if isinstance(stored_header, dict):
            firm_header = stored_header
    return firm_name, advisor_name, firm_header


@router.post("/report")
def download_stress_report(req: SimulationRequest, authorization: Optional[str] = Header(default=None)):
    from routers.portfolios import _require_assignments

    user_id, assigned, db = _require_assignments(authorization)
    if str(req.portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    owned = (
        db.table("portfolios")
        .select("id,name,firm_id")
        .eq("id", str(req.portfolio_id))
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    holdings = (
        db.table("portfolio_holdings")
        .select("ticker,asset_class,quantity,current_price,duration_years")
        .eq("portfolio_id", str(req.portfolio_id))
        .execute()
    )
    try:
        audience = req.audience if req.audience in {"client", "advisor"} else "advisor"
        if audience == "advisor" and req.distribution_model not in DISTRIBUTION_PARAMETERS:
            raise HTTPException(status_code=400, detail="Unsupported distribution model.")
        scenarios = run_all_scenarios(
            holdings.data or [],
            _cash_daily_return(),
            req.yield_bps,
            req.equity_pct,
            req.use_worst_equity_window,
        )
        cone = longevity_cone(float(scenarios[0]["baseline_value"])) if audience == "client" else None
        firm_name, advisor_name, firm_header = _report_identity(user_id, owned.data[0].get("firm_id"), db)
        pdf_bytes = build_stress_report(
            owned.data[0].get("name") or "Portfolio",
            scenarios,
            audience,
            cone,
            {
                "distribution_model": req.distribution_model,
                "macro_shock_bps": req.macro_shock_bps,
                "simulations": req.simulations,
                "time_horizon_years": req.time_horizon_years,
            },
            firm_name,
            advisor_name,
            firm_header=firm_header,
        )
    except LiveRiskError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not build the stress-test report: {exc}") from exc

    filename = f"{audience}-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
