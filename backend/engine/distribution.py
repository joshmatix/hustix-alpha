"""Parametric Monte Carlo. Paths are synthetic. The start value is supplied by the caller."""

import numpy as np
import scipy.stats as stats

_BATCH = 2000
CONE_YEARS = 10
CONE_PATHS = 4000
CONE_MODEL = "student_t"
DISTRIBUTION_PARAMETERS = {
    "student_t": {"df": 5, "loc": 0.0004, "scale": 0.012},
    "normal": {"loc": 0.0004, "scale": 0.012},
    "bootstrap": {"source_size": 1000, "loc": 0.0004, "scale": 0.011},
}
DISTRIBUTION_LABELS = {
    "student_t": "Student's t",
    "normal": "Normal",
    "bootstrap": "Bootstrap",
}


def run_distribution(
    starting_value: float,
    simulations: int,
    time_horizon_years: int,
    distribution_model: str,
    macro_shock_bps: float,
) -> dict:
    if starting_value <= 0:
        raise ValueError("Starting value must be positive.")
    n_days = time_horizon_years * 252
    shock_adjustment = 1.0 - (macro_shock_bps / 10000.0)
    final_values = _terminal_values(
        starting_value,
        simulations,
        n_days,
        distribution_model,
        shock_adjustment,
    )

    p5 = float(np.percentile(final_values, 5))
    p50 = float(np.percentile(final_values, 50))
    p95 = float(np.percentile(final_values, 95))
    tail = final_values[final_values <= p5]
    shortfall = float(np.mean(tail)) if tail.size else p5
    return {
        "distribution_model": distribution_model,
        "macro_shock_bps": macro_shock_bps,
        "time_horizon_years": time_horizon_years,
        "starting_value": starting_value,
        "metrics": {
            "p5": p5,
            "p25": float(np.percentile(final_values, 25)),
            "p50": p50,
            "p75": float(np.percentile(final_values, 75)),
            "p95": p95,
            "var_95": float(starting_value - p5),
            "expected_shortfall_95": float(starting_value - shortfall),
        },
        "paths_sampled": simulations,
    }


def _terminal_values(
    starting_value: float,
    simulations: int,
    n_days: int,
    distribution_model: str,
    shock_adjustment: float,
) -> np.ndarray:
    finals = []
    remaining = simulations
    while remaining:
        batch = min(_BATCH, remaining)
        daily = _daily_returns(distribution_model, batch, n_days)
        growth = np.prod(1.0 + daily * shock_adjustment, axis=1)
        finals.append(starting_value * growth)
        remaining -= batch
    return np.concatenate(finals)


def longevity_cone(starting_value: float, years: int = CONE_YEARS, simulations: int = CONE_PATHS) -> list[dict]:
    """Year-end account values for a difficult, typical, and strong path.

    The draw itself stays inside this module. Callers only receive the values.
    """
    if starting_value <= 0:
        raise ValueError("Starting value must be positive.")
    wealth = np.full(simulations, float(starting_value))
    cone = [{"year": 0, "low": float(starting_value), "mid": float(starting_value), "high": float(starting_value)}]
    for year in range(1, years + 1):
        daily = _daily_returns(CONE_MODEL, simulations, 252)
        wealth = wealth * np.prod(1.0 + daily, axis=1)
        cone.append({
            "year": year,
            "low": float(np.percentile(wealth, 5)),
            "mid": float(np.percentile(wealth, 50)),
            "high": float(np.percentile(wealth, 95)),
        })
    return cone


def _daily_returns(distribution_model: str, simulations: int, n_days: int) -> np.ndarray:
    shape = (simulations, n_days)
    params = DISTRIBUTION_PARAMETERS.get(distribution_model)
    if params is None:
        raise ValueError(f"Unsupported distribution model: {distribution_model}")
    if distribution_model == "student_t":
        return stats.t.rvs(df=params["df"], loc=params["loc"], scale=params["scale"], size=shape)
    if distribution_model == "normal":
        return np.random.normal(loc=params["loc"], scale=params["scale"], size=shape)
    history = np.random.normal(loc=params["loc"], scale=params["scale"], size=(params["source_size"],))
    return np.random.choice(history, size=shape)
