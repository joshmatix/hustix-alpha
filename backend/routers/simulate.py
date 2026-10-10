from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Dict
import numpy as np

from engine.output_formatter import format_analysis_output

router = APIRouter(prefix="/api/v1", tags=["Simulation"])

SCENARIO_DELTAS = {
    "Stagflation": np.array([-0.12, -0.09, 0.10, -0.02]),
    "Rate_Shock": np.array([-0.05, -0.08, 0.00, 0.02]),
    "Soft_Landing": np.array([0.04, 0.03, 0.01, 0.00]),
    "Base": np.array([0.02, 0.01, 0.01, 0.00]),
}

ASSET_KEYS = ["Equities", "Bonds", "Real_Assets", "Cash"]


class SimulationRequest(BaseModel):
    portfolio_value: float = Field(gt=0, json_schema_extra={"example": 1000000})
    weights: Dict[str, float] = Field(
        default_factory=lambda: {
            "Equities": 0.60,
            "Bonds": 0.25,
            "Real_Assets": 0.10,
            "Cash": 0.05,
        }
    )
    scenario: str = Field(default="Rate_Shock")


@router.post("/simulate")
def run_stress_test(req: SimulationRequest):
    scenario_key = req.scenario if req.scenario in SCENARIO_DELTAS else "Base"
    drift_deltas = SCENARIO_DELTAS[scenario_key]

    w = np.array([float(req.weights.get(k, 0.0)) for k in ASSET_KEYS])
    weight_sum = float(np.sum(w))
    if weight_sum > 0:
        w = w / weight_sum

    returns_sim = np.random.normal(0.05 + float(np.dot(w, drift_deltas)), 0.12, 1000)
    shocked_values = req.portfolio_value * (1 + returns_sim)
    mean_shocked = float(np.mean(shocked_values))
    var_95_loss = float(np.percentile(shocked_values, 5) - req.portfolio_value)
    loss_ratio = abs(var_95_loss) / req.portfolio_value
    overall_score = int(min(100, max(0, round(loss_ratio * 400))))

    simulation_results = {
        "baseline_value": req.portfolio_value,
        "mean_shocked_value": mean_shocked,
        "var_95_loss": var_95_loss,
        "status": "completed",
    }
    formatted = format_analysis_output(simulation_results, scenario_key)

    return {
        **simulation_results,
        "scenario": scenario_key,
        "overall_score": overall_score,
        "asset_impacts": {
            "Equities": round(float(drift_deltas[0]) * 100, 1),
            "Bonds": round(float(drift_deltas[1]) * 100, 1),
            "Real_Assets": round(float(drift_deltas[2]) * 100, 1),
            "Cash": round(float(drift_deltas[3]) * 100, 1),
        },
        "narrative": formatted["client_narrative"],
        "metrics": formatted["metrics"],
    }
