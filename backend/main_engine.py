# main_engine.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict
import numpy as np

app = FastAPI(title="Macro Risk Engine")

class SimulationRequest(BaseModel):
    portfolio_value: float
    weights: Dict[str, float]
    scenario: str # "Stagflation", "Rate_Shock", "Base"

@app.post("/api/v1/simulate")
def run_stress_test(req: SimulationRequest):
    # Retrieve macro shift deltas based on scenario
    if req.scenario == "Stagflation":
        drift_deltas = np.array([-0.12, -0.09, 0.10, -0.02])
    elif req.scenario == "Rate_Shock":
        drift_deltas = np.array([-0.05, -0.08, 0.00, 0.02])
    else:
        drift_deltas = np.array([0.0, 0.0, 0.0, 0.0])

    # Convert incoming weights dict to array
    w = np.array([req.weights.get(k, 0.0) for k in ["Equities", "Bonds", "Real_Assets", "Cash"]])
    
    # 1,000 Path Quick Monte Carlo Output
    returns_sim = np.random.normal(0.05 + np.dot(w, drift_deltas), 0.12, 1000)
    shocked_values = req.portfolio_value * (1 + returns_sim)

    return {
        "baseline_value": req.portfolio_value,
        "mean_shocked_value": float(np.mean(shocked_values)),
        "var_95_loss": float(np.percentile(shocked_values, 5) - req.portfolio_value),
        "status": "completed"
    }
