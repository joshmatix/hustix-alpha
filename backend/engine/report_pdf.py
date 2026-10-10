"""PDF macro stress-test report for the three preset scenarios."""

from datetime import datetime, timezone

from fpdf import FPDF

from engine.output_formatter import format_analysis_output

SCENARIO_LABELS = {
    "Rate_Shock": "+200bps Rate Hike",
    "Stagflation": "Stagflation Shock",
    "Soft_Landing": "Soft Landing Cut",
}
SCENARIO_NOTES = {
    "Rate_Shock": "Yields rise 200 basis points. Impacts use each holding's live sensitivity to the 10-year yield.",
    "Stagflation": "Yields rise 100 basis points, and the worst three-month S&P move in the price history is applied through each holding's market beta.",
    "Soft_Landing": "Yields fall 100 basis points. Impacts use each holding's live sensitivity to the 10-year yield.",
}


def _latin(value: object) -> str:
    return str(value).encode("latin-1", "replace").decode("latin-1")


def _money(value: float) -> str:
    return f"${value:,.0f}"


def _pct(value: float) -> str:
    return f"{value:+.1f}%"


class _Report(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"MacroRisk Studio  |  Page {self.page_no()}", align="C")


def build_stress_report(portfolio_name: str, scenarios: list[dict]) -> bytes:
    if not scenarios:
        raise ValueError("No scenario results to report.")

    baseline = float(scenarios[0]["baseline_value"])
    history_days = int(scenarios[0]["history_days"])
    generated = datetime.now(timezone.utc).strftime("%B %d, %Y")
    holdings = scenarios[0].get("holding_rows") or []

    pdf = _Report()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.set_text_color(20, 20, 20)

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "Macro Stress Test Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, _latin(portfolio_name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 6, f"Prepared {generated}  |  Account value {_money(baseline)}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        6,
        f"Priced from {history_days} Yahoo Finance trading days. Each scenario is applied once, on top of live volatility.",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Holdings", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(235, 238, 245)
    for label, width in (("Ticker", 35), ("Class", 45), ("Quantity", 35), ("Price", 35), ("Market value", 40)):
        pdf.cell(width, 7, label, border=0, fill=True)
    pdf.ln(7)
    pdf.set_font("Helvetica", "", 9)
    if not holdings:
        pdf.cell(0, 7, "No holdings listed.", new_x="LMARGIN", new_y="NEXT")
    for row in holdings:
        pdf.cell(35, 7, _latin(row["ticker"]))
        pdf.cell(45, 7, _latin(row["asset_class"]))
        pdf.cell(35, 7, f"{float(row['quantity']):,.2f}")
        pdf.cell(35, 7, f"${float(row['price']):,.2f}")
        pdf.cell(40, 7, _money(float(row["market_value"])), new_x="LMARGIN", new_y="NEXT")

    for result in scenarios:
        key = result["scenario"]
        impacts = result["asset_impacts"]
        loss = abs(float(result["var_95_loss"]))
        loss_pct = (loss / baseline * 100) if baseline else 0
        narrative = format_analysis_output(
            {
                "baseline_value": baseline,
                "mean_shocked_value": result["mean_shocked_value"],
                "var_95_loss": result["var_95_loss"],
                "history_days": history_days,
            },
            key,
        )["client_narrative"]

        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(20, 20, 20)
        pdf.cell(0, 8, _latin(SCENARIO_LABELS.get(key, key)), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.multi_cell(0, 5, _latin(SCENARIO_NOTES.get(key, "")))
        pdf.ln(1)
        pdf.set_text_color(20, 20, 20)
        pdf.set_font("Helvetica", "", 10)
        lines = [
            f"Vulnerability score: {int(result['overall_score'])} / 100",
            f"95% one-year loss: {_money(loss)} ({loss_pct:.1f}% of the account)",
            f"Average shocked value: {_money(float(result['mean_shocked_value']))}",
            f"Equities {_pct(float(impacts.get('Equities', 0)))}    "
            f"Bonds {_pct(float(impacts.get('Bonds', 0)))}    "
            f"Real assets {_pct(float(impacts.get('Real_Assets', 0)))}    "
            f"Cash {_pct(float(impacts.get('Cash', 0)))}",
        ]
        for line in lines:
            pdf.cell(0, 6, _latin(line), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, _latin(narrative))

    return bytes(pdf.output())
