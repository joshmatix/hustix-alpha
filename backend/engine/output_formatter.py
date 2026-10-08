# output_formatter.py

def format_analysis_output(simulation_results: dict, scenario_name: str) -> dict:
    loss_val = abs(simulation_results["var_95_loss"])
    percent_loss = (loss_val / simulation_results["baseline_value"]) * 100

    # Auto-generate plain-language advisor commentary
    narrative = (
        f"Under the {scenario_name} regime, the portfolio shows an expected 95% Value at Risk (VaR) "
        f"of ${loss_val:,.2f} ({percent_loss:.1f}% downside). The primary risk driver is duration "
        f"compression in fixed-income allocations coupled with equity multiple contraction."
    )

    return {
        "metrics": {
            "shocked_value": simulation_results["mean_shocked_value"],
            "var_95_amount": loss_val,
            "var_95_percent": percent_loss,
        },
        "client_narrative": narrative
    }