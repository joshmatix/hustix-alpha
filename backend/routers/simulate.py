from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID

from database import supabase
from engine.live_risk import LiveRiskError, run_all_scenarios, run_live_stress
from engine.output_formatter import format_analysis_output
from engine.report_pdf import build_stress_report

router = APIRouter(prefix="/api/v1", tags=["Simulation"])


class SimulationRequest(BaseModel):
    portfolio_id: UUID
    scenario: str = Field(default="Rate_Shock")
    portfolio_value: Optional[float] = None
    weights: Optional[dict] = None


def _cash_daily_return() -> float:
    try:
        from engine.macro_feeds import fetch_macro_indicators

        fed_funds = fetch_macro_indicators().get("Fed_Funds_Rate") or 0.0
        return float(fed_funds) / 100.0 / 252.0
    except Exception:
        return 0.0


@router.post("/simulate")
def run_stress_test(req: SimulationRequest, authorization: Optional[str] = Header(default=None)):
    from routers.portfolios import _require_user_id

    user_id = _require_user_id(authorization)
    owned = (
        supabase.table("portfolios")
        .select("id")
        .eq("id", str(req.portfolio_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    holdings = (
        supabase.table("portfolio_holdings")
        .select("ticker,asset_class,quantity,current_price")
        .eq("portfolio_id", str(req.portfolio_id))
        .execute()
    )
    try:
        result = run_live_stress(holdings.data or [], req.scenario, _cash_daily_return())
    except LiveRiskError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live market data request failed: {exc}") from exc

    simulation_results = {
        "baseline_value": result["baseline_value"],
        "mean_shocked_value": result["mean_shocked_value"],
        "var_95_loss": result["var_95_loss"],
        "history_days": result["history_days"],
        "status": "completed",
    }
    formatted = format_analysis_output(simulation_results, result["scenario"])
    return {
        **simulation_results,
        "scenario": result["scenario"],
        "overall_score": result["overall_score"],
        "asset_impacts": result["asset_impacts"],
        "scenario_days": result["scenario_days"],
        "paths": result["paths"],
        "data_mode": "live",
        "narrative": formatted["client_narrative"],
        "metrics": formatted["metrics"],
    }


@router.post("/report")
def download_stress_report(req: SimulationRequest, authorization: Optional[str] = Header(default=None)):
    from routers.portfolios import _require_user_id

    user_id = _require_user_id(authorization)
    owned = (
        supabase.table("portfolios")
        .select("id,name")
        .eq("id", str(req.portfolio_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    holdings = (
        supabase.table("portfolio_holdings")
        .select("ticker,asset_class,quantity,current_price")
        .eq("portfolio_id", str(req.portfolio_id))
        .execute()
    )
    try:
        scenarios = run_all_scenarios(holdings.data or [], _cash_daily_return())
        pdf_bytes = build_stress_report(owned.data[0].get("name") or "Portfolio", scenarios)
    except LiveRiskError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not build the stress-test report: {exc}") from exc

    filename = "macro-stress-test.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
