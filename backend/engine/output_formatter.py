# output_formatter.py

def format_analysis_output(simulation_results: dict, scenario_name: str) -> dict:
    loss_val = abs(simulation_results["var_95_loss"])
    percent_loss = (loss_val / simulation_results["baseline_value"]) * 100

    history_days = simulation_results.get("history_days")
    label = scenario_name.replace("_", " ")
    if history_days:
        narrative = (
            f"Under the {label} scenario, the 95% one-year loss is "
            f"${loss_val:,.0f} ({percent_loss:.1f}% of the account). "
            f"Prices and yield sensitivity come from {history_days} Yahoo Finance trading days "
            f"for the holdings in this portfolio. The scenario is applied once, on top of that live volatility."
        )
    else:
        narrative = (
            f"Under the {label} scenario, the portfolio shows an expected 95% Value at Risk (VaR) "
            f"of ${loss_val:,.2f} ({percent_loss:.1f}% downside)."
        )

    return {
        "metrics": {
            "shocked_value": simulation_results["mean_shocked_value"],
            "var_95_amount": loss_val,
            "var_95_percent": percent_loss,
        },
        "client_narrative": narrative
    }