"""PDF macro stress-test report for the three preset scenarios."""

import hashlib
from datetime import datetime, timezone
from io import BytesIO

import requests
from fpdf import FPDF

from engine.distribution import CONE_MODEL, CONE_PATHS, CONE_YEARS, DISTRIBUTION_LABELS, DISTRIBUTION_PARAMETERS
from engine.live_risk import HORIZON_DAYS, LOOKBACK, N_PATHS
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
CLIENT_NOTES = {
    "Rate_Shock": "Interest rates rise by 2 percentage points.",
    "Stagflation": "Inflation stays high while markets fall.",
    "Soft_Landing": "Interest rates fall by 1 percentage point.",
}
HEADER_BRANDING = {
    "backgroundColor": "#F1F5F9",
    "textColor": "#323232",
    "accentColor": "#3B82F6",
    "fontFamily": "Helvetica, sans-serif",
    "fontSize": "16px",
    "logo": {
        "url": "",
        "position": "left",
        "height": "32px",
        "altText": "",
    },
}
HEADER_OPTIONS = {
    "showDate": False,
    "showReportId": False,
    "borderBottom": "",
}


def _latin(value: object) -> str:
    return str(value).encode("latin-1", "replace").decode("latin-1")


def _hex_rgb(value: str) -> tuple[int, int, int]:
    raw = str(value or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return (30, 41, 59)
    return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))


def _css_px_mm(value: str, default_px: float) -> float:
    raw = str(value or "").strip().lower()
    if raw.endswith("px"):
        pixels = float(raw[:-2] or default_px)
    elif raw.endswith("pt"):
        return float(raw[:-2] or default_px) * 25.4 / 72
    else:
        try:
            pixels = float(raw)
        except ValueError:
            pixels = default_px
    return pixels * 25.4 / 96


def _css_px_pt(value: str, default_px: float) -> float:
    return _css_px_mm(value, default_px) * 72 / 25.4


def _pdf_font(family: str) -> str:
    name = str(family or "").split(",")[0].strip().strip("'\"").lower()
    if name in {"times", "times new roman", "serif"}:
        return "Times"
    if name in {"courier", "monospace"}:
        return "Courier"
    return "Helvetica"


def _parse_border(value: str) -> tuple[float, tuple[int, int, int]] | None:
    parts = str(value or "").split()
    if len(parts) < 3 or parts[1].lower() != "solid":
        return None
    return _css_px_mm(parts[0], 2), _hex_rgb(parts[-1])


def _image_pixels(data: bytes) -> tuple[int, int] | None:
    if data.startswith(b"\x89PNG") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 8 < len(data):
            if data[index] != 0xFF:
                break
            marker = data[index + 1]
            if marker in {0xC0, 0xC1, 0xC2}:
                height = int.from_bytes(data[index + 5:index + 7], "big")
                width = int.from_bytes(data[index + 7:index + 9], "big")
                return width, height
            length = int.from_bytes(data[index + 2:index + 4], "big")
            index += 2 + length
    return None


def _load_logo(logo: dict) -> tuple[bytes, int, int] | None:
    url = str((logo or {}).get("url") or "").strip()
    if not url:
        return None
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
    except requests.RequestException:
        return None
    data = response.content
    pixels = _image_pixels(data)
    if not pixels or pixels[0] <= 0 or pixels[1] <= 0:
        return None
    return data, pixels[0], pixels[1]


def build_report_header(
    *,
    firm_name: str,
    advisor_name: str,
    report_title: str,
    report_subtitle: str,
    generated_at: datetime | None = None,
    report_id: str = "",
    firm_header: dict | None = None,
) -> dict:
    """Header document. Branding and options come from the firm's JSON."""
    stamp = generated_at or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    if not report_id:
        digest = hashlib.sha256(stamp.isoformat().encode()).hexdigest()
        report_id = f"REP-{int(digest[:6], 16) % 100000:05d}"
    stored = firm_header if isinstance(firm_header, dict) else {}
    stored_branding = stored.get("branding") if isinstance(stored.get("branding"), dict) else {}
    stored_logo = stored_branding.get("logo") if isinstance(stored_branding.get("logo"), dict) else {}
    branding = {**HEADER_BRANDING, **stored_branding}
    branding["logo"] = {**HEADER_BRANDING["logo"], **stored_logo}
    stored_options = stored.get("options") if isinstance(stored.get("options"), dict) else {}
    return {
        "branding": branding,
        "metadata": {
            "reportTitle": report_title,
            "reportSubtitle": report_subtitle,
            "tenantName": firm_name or "Not on file",
            "advisorName": advisor_name or "Not on file",
            "generatedAt": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "reportId": report_id,
        },
        "options": {**HEADER_OPTIONS, **stored_options},
    }


def _money(value: float) -> str:
    return f"${value:,.0f}"


def _pct(value: float) -> str:
    return f"{value:+.1f}%"


def _scenario_table(pdf: FPDF, rows: list[tuple[str, str]]) -> None:
    label_width = 70
    value_width = pdf.w - pdf.l_margin - pdf.r_margin - label_width
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(235, 238, 245)
    pdf.set_text_color(20, 20, 20)
    pdf.set_draw_color(203, 213, 225)
    pdf.cell(label_width, 7, "Measure", border=1, fill=True)
    pdf.cell(value_width, 7, "Value", border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    for index, (label, value) in enumerate(rows):
        pdf.set_fill_color(248, 250, 252)
        pdf.cell(label_width, 7, _latin(label), border=1, fill=index % 2 == 1)
        pdf.cell(value_width, 7, _latin(value), border=1, fill=index % 2 == 1, new_x="LMARGIN", new_y="NEXT")


def _asset_table(pdf: FPDF, columns: list[tuple[str, str]]) -> None:
    width = (pdf.w - pdf.l_margin - pdf.r_margin) / len(columns)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(235, 238, 245)
    pdf.set_text_color(20, 20, 20)
    pdf.set_draw_color(203, 213, 225)
    for index, (label, _value) in enumerate(columns):
        pdf.cell(width, 7, _latin(label), border=1, fill=True, align="C", new_x="LMARGIN" if index == len(columns) - 1 else "RIGHT", new_y="NEXT" if index == len(columns) - 1 else "TOP")
    pdf.set_font("Helvetica", "", 9)
    for index, (_label, value) in enumerate(columns):
        pdf.cell(width, 7, _latin(value), border=1, align="C", new_x="LMARGIN" if index == len(columns) - 1 else "RIGHT", new_y="NEXT" if index == len(columns) - 1 else "TOP")


class _Report(FPDF):
    def __init__(self, header: dict):
        super().__init__()
        self.header_config = header
        logo = (header.get("branding") or {}).get("logo") or {}
        self._logo = _load_logo(logo)

    def header(self):
        branding = self.header_config.get("branding") or {}
        metadata = self.header_config.get("metadata") or {}
        options = self.header_config.get("options") or {}
        background = _hex_rgb(branding.get("backgroundColor"))
        ink = _hex_rgb(branding.get("textColor") or "#FFFFFF")
        font = _pdf_font(branding.get("fontFamily") or "")
        size = _css_px_pt(str(branding.get("fontSize") or "14px"), 14)
        self.set_fill_color(*background)
        self.rect(0, 0, self.w, self.t_margin, style="F")
        border = _parse_border(str(options.get("borderBottom") or ""))
        if border:
            self.set_draw_color(*border[1])
            self.set_line_width(max(border[0], 0.2))
            self.line(0, self.t_margin, self.w, self.t_margin)

        logo_cfg = branding.get("logo") or {}
        logo_h = min(_css_px_mm(str(logo_cfg.get("height") or "32px"), 32), self.t_margin - 4)
        text_x = self.l_margin
        if self._logo and str(logo_cfg.get("position") or "left") == "left":
            data, pixels_w, pixels_h = self._logo
            logo_w = logo_h * pixels_w / pixels_h
            self.image(BytesIO(data), x=self.l_margin, y=(self.t_margin - logo_h) / 2, h=logo_h)
            text_x = self.l_margin + logo_w + 2

        right_lines = []
        advisor = str(metadata.get("advisorName") or "").strip()
        if advisor:
            right_lines.append(f"Advisor: {advisor}")
        if options.get("showDate") and metadata.get("generatedAt"):
            raw = str(metadata["generatedAt"]).replace("Z", "+00:00")
            right_lines.append(datetime.fromisoformat(raw).strftime("%B %d, %Y"))
        if options.get("showReportId") and metadata.get("reportId"):
            right_lines.append(str(metadata["reportId"]))

        self.set_text_color(*ink)
        self.set_font(font, "", size)
        name_h = max(size * 0.45, 5)
        self.set_xy(text_x, (self.t_margin - name_h) / 2)
        self.cell(self.w / 2 - text_x, name_h, _latin(metadata.get("tenantName") or ""), align="L")
        if right_lines:
            block_h = name_h * len(right_lines)
            y = (self.t_margin - block_h) / 2
            right_size = 9 if len(right_lines) == 1 else max(size - 2, 8)
            self.set_font(font, "", right_size)
            for line in right_lines:
                self.set_xy(self.w / 2, y)
                self.cell(self.w / 2 - self.r_margin, name_h, _latin(line), align="R")
                y += name_h
        self.set_y(self.t_margin)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"MacroRisk Studio  |  Page {self.page_no()}", align="C")


def build_stress_report(
    portfolio_name: str,
    scenarios: list[dict],
    audience: str = "advisor",
    cone: list[dict] | None = None,
    distribution: dict | None = None,
    firm_name: str = "",
    advisor_name: str = "",
    header: dict | None = None,
    firm_header: dict | None = None,
) -> bytes:
    if audience not in {"client", "advisor"}:
        raise ValueError("Report audience must be client or advisor.")
    if not scenarios:
        raise ValueError("No scenario results to report.")

    baseline = float(scenarios[0]["baseline_value"])
    history_days = int(scenarios[0]["history_days"])
    generated_at = datetime.now(timezone.utc)
    generated = generated_at.strftime("%B %d, %Y")
    holdings = scenarios[0].get("holding_rows") or []
    for_client = audience == "client"
    if header is None:
        header = build_report_header(
            firm_name=firm_name,
            advisor_name=advisor_name,
            report_title="Client Report" if for_client else "Advisor Report",
            report_subtitle=portfolio_name,
            generated_at=generated_at,
            firm_header=firm_header,
        )
    branding = header.get("branding") or {}
    logo_h = _css_px_mm(str((branding.get("logo") or {}).get("height") or "0px"), 0) if (branding.get("logo") or {}).get("url") else 0
    pdf = _Report(header)
    pdf.set_top_margin(max(16, logo_h + 8))
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.set_text_color(20, 20, 20)

    title = (header.get("metadata") or {}).get("reportTitle") or (
        "Client Report" if for_client else "Advisor Report"
    )
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _latin(title), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, _latin(portfolio_name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 6, f"Prepared {generated}  |  Account value {_money(baseline)}", new_x="LMARGIN", new_y="NEXT")
    if for_client:
        pdf.multi_cell(
            0,
            5,
            "These figures describe how this account could respond to economic conditions. They are not a recommendation to buy, sell, or hold.",
        )
        pdf.ln(4)
        _write_client_body(pdf, scenarios, baseline, cone or [])
        return bytes(pdf.output())
    else:
        pdf.cell(
            0,
            6,
            f"Priced from {history_days} Yahoo Finance trading days. Each scenario is applied once, on top of live volatility.",
            new_x="LMARGIN",
            new_y="NEXT",
        )
    pdf.ln(4)

    if not for_client:
        _write_methodology(pdf, scenarios, distribution or {})
        pdf.ln(2)

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
        with pdf.unbreakable() as block:
            block.set_font("Helvetica", "B", 13)
            block.set_text_color(20, 20, 20)
            block.cell(0, 8, _latin(SCENARIO_LABELS.get(key, key)), new_x="LMARGIN", new_y="NEXT")
            block.set_font("Helvetica", "", 9)
            block.set_text_color(80, 80, 80)
            note = SCENARIO_NOTES.get(key, "")
            block.multi_cell(0, 5, _latin(note), new_x="LMARGIN", new_y="NEXT")
            block.ln(1)
            impact = result.get("portfolio_impact")
            _scenario_table(
                block,
                [
                    ("Portfolio impact", _pct(float(impact)) if impact is not None else "—"),
                    ("Vulnerability score", f"{int(result['overall_score'])} / 100"),
                    ("95% one-year loss", f"{_money(loss)} ({loss_pct:.1f}% of the account)"),
                    ("Average shocked value", _money(float(result["mean_shocked_value"]))),
                ],
            )
            block.ln(2)
            _asset_table(
                block,
                [
                    ("Equities", _pct(float(impacts.get("Equities", 0)))),
                    ("Bonds", _pct(float(impacts.get("Bonds", 0)))),
                    ("Real assets", _pct(float(impacts.get("Real_Assets", 0)))),
                    ("Cash", _pct(float(impacts.get("Cash", 0)))),
                ],
            )
            block.ln(2)
            block.set_text_color(20, 20, 20)
            block.set_font("Helvetica", "", 9)
            block.multi_cell(0, 5, _latin(narrative), new_x="LMARGIN", new_y="NEXT")

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

    return bytes(pdf.output())


def _write_methodology(pdf: FPDF, scenarios: list[dict], distribution: dict) -> None:
    first = scenarios[0]
    model_key = str(distribution.get("distribution_model") or "student_t")
    label = DISTRIBUTION_LABELS.get(model_key, model_key)
    params = DISTRIBUTION_PARAMETERS.get(model_key, {})
    shock_bps = float(distribution.get("macro_shock_bps") or 0)
    paths = int(distribution.get("simulations") or 0)
    years = int(distribution.get("time_horizon_years") or 0)
    cone_params = DISTRIBUTION_PARAMETERS[CONE_MODEL]

    rows = [
        ("Historical source", "Yahoo Finance daily prices"),
        ("Requested range", LOOKBACK),
        ("Period used", f"{first.get('history_start')} through {first.get('history_end')}"),
        ("Overlapping trading days", f"{int(first['history_days']):,} (holdings, SPY, and the 10-year yield)"),
        ("Stress test paths", f"{int(first.get('paths') or N_PATHS):,}"),
        ("Stress test horizon", f"{int(first.get('horizon_days') or HORIZON_DAYS)} trading days"),
        ("Cash accrual", f"{float(first.get('cash_daily_return') or 0):.8f} per day"),
    ]
    for result in scenarios:
        name = SCENARIO_LABELS.get(result["scenario"], result["scenario"])
        points = float(result.get("yield_shock") or 0)
        rows.append((f"Yield shock, {name}", f"{points * 100:+.0f} basis points ({points:+.1f} percentage points)"))
        growth = float(result.get("growth_shock") or 0)
        if growth:
            rows.append(("Stagflation equity-window shock", f"{growth * 100:+.1f}% over 63 trading days"))
    rows.extend([
        ("Distribution model", f"{label} ({model_key})"),
        ("Distribution parameters", ", ".join(f"{name}={value:g}" for name, value in params.items())),
        ("Distribution yield shock", f"{shock_bps:+.1f} basis points"),
        ("Distribution daily multiplier", f"{1.0 - shock_bps / 10000.0:.6f}"),
        ("Distribution Monte Carlo paths", f"{paths:,}"),
        ("Distribution horizon", f"{years} years ({years * 252:,} trading days)"),
        ("Client longevity model", f"{DISTRIBUTION_LABELS[CONE_MODEL]} ({CONE_MODEL})"),
        ("Client longevity parameters", ", ".join(f"{name}={value:g}" for name, value in cone_params.items())),
        ("Client longevity paths", f"{CONE_PATHS:,}"),
        ("Client longevity horizon", f"{CONE_YEARS} years"),
        ("Client longevity yield shock", "0 basis points"),
    ])

    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Methodology record", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    width = pdf.w - pdf.l_margin - pdf.r_margin
    with pdf.table(
        width=width,
        col_widths=(68, width - 68),
        text_align="LEFT",
        line_height=4.5,
        padding=1.2,
    ) as table:
        heading = table.row()
        heading.cell("Item")
        heading.cell("Setting")
        for item, setting in rows:
            row = table.row()
            row.cell(_latin(item))
            row.cell(_latin(setting))


def _write_client_body(pdf: FPDF, scenarios: list[dict], baseline: float, cone: list[dict]) -> None:
    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Stress test outcomes", new_x="LMARGIN", new_y="NEXT")
    hardest_name = ""
    hardest_impact = 0.0
    for result in scenarios:
        key = result["scenario"]
        label = SCENARIO_LABELS.get(key, key)
        impact = float(result.get("portfolio_impact", 0))
        if impact < hardest_impact:
            hardest_impact = impact
            hardest_name = label
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(20, 20, 20)
        pdf.cell(0, 7, _latin(f"Portfolio Impact under {label}: {impact:+.1f}%"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(50, 50, 50)
        pdf.multi_cell(0, 5, _latin(_client_takeaway(key, impact, baseline)))
        pdf.ln(1)

    pdf.ln(2)
    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Range of account values over 10 years", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(50, 50, 50)
    pdf.multi_cell(
        0,
        5,
        "All three lines start at today's account value. The top line is if things go well, the middle line is a typical path, and the bottom line is if things go badly. The shaded area is that range. It is not a promise.",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(2)
    if cone:
        _draw_cone(pdf, cone)
        last = cone[-1]
        pdf.ln(2)
        pdf.set_text_color(20, 20, 20)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(
            0,
            5,
            _latin(
                f"After 10 years, a difficult path is about {_money(last['low'])}, "
                f"a typical path is about {_money(last['mid'])}, "
                f"and a strong path is about {_money(last['high'])}."
            ),
        )

    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "What this means", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    if hardest_name:
        closing = (
            f"The harder economic setting for this account is {hardest_name}, "
            f"with a portfolio impact of {hardest_impact:+.1f}%. "
            "The 10-year range shows how far the account could fall in a difficult stretch "
            "and how far it could rise if conditions are favorable."
        )
    else:
        closing = "The scenarios above are the economic settings that would move this account the most."
    pdf.multi_cell(0, 5, _latin(closing))


def _client_takeaway(scenario: str, impact: float, baseline: float) -> str:
    dollars = abs(baseline * impact / 100.0)
    setting = CLIENT_NOTES.get(scenario, "This economic setting")
    if impact < 0:
        return f"{setting} In that setting the account would be about {_money(dollars)} lower ({impact:+.1f}%)."
    if impact > 0:
        return f"{setting} In that setting the account would be about {_money(dollars)} higher ({impact:+.1f}%)."
    return f"{setting} In that setting the account value would be little changed."


def _draw_cone(pdf: FPDF, cone: list[dict]) -> None:
    left = pdf.l_margin
    width = pdf.w - pdf.l_margin - pdf.r_margin
    label_width = 36
    plot_width = width - label_width - 4
    top = pdf.get_y()
    height = 68
    lows = [row["low"] for row in cone]
    highs = [row["high"] for row in cone]
    floor = min(lows) * 0.92
    ceiling = max(highs) * 1.06
    span = ceiling - floor or 1
    last = max(len(cone) - 1, 1)

    def x_at(index: int) -> float:
        return left + (plot_width * index / last)

    def y_at(value: float) -> float:
        return top + height - ((value - floor) / span) * height

    upper = [(x_at(i), y_at(row["high"])) for i, row in enumerate(cone)]
    lower = [(x_at(i), y_at(row["low"])) for i, row in enumerate(reversed(cone))]
    pdf.set_fill_color(226, 232, 240)
    pdf.polygon(upper + lower, style="F")

    series = (
        ("high", (22, 101, 52)),
        ("mid", (30, 64, 175)),
        ("low", (185, 28, 28)),
    )
    pdf.set_line_width(0.6)
    for key, color in series:
        pdf.set_draw_color(*color)
        points = [(x_at(i), y_at(row[key])) for i, row in enumerate(cone)]
        for start, end in zip(points, points[1:]):
            pdf.line(start[0], start[1], end[0], end[1])
        pdf.set_fill_color(*color)
        pdf.ellipse(points[-1][0] - 0.9, points[-1][1] - 0.9, 1.8, 1.8, style="F")

    start_value = float(cone[0]["mid"])
    pdf.set_fill_color(30, 41, 59)
    pdf.ellipse(x_at(0) - 1.1, y_at(start_value) - 1.1, 2.2, 2.2, style="F")

    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(71, 85, 105)
    year_labels = {0: f"Today {_money(start_value)}", 5: "5 years", 10: "10 years"}
    for index, row in enumerate(cone):
        caption = year_labels.get(row["year"])
        if not caption:
            continue
        caption_width = pdf.get_string_width(caption)
        caption_x = min(max(left, x_at(index) - caption_width / 2), left + plot_width - caption_width)
        pdf.text(caption_x, top + height + 6, _latin(caption))

    endings = [
        ("If things go well", float(cone[-1]["high"]), (22, 101, 52)),
        ("A typical path", float(cone[-1]["mid"]), (30, 64, 175)),
        ("If things go badly", float(cone[-1]["low"]), (185, 28, 28)),
    ]
    placed = sorted((y_at(value), title, value, color) for title, value, color in endings)
    gap = 9
    nudged = [list(item) for item in placed]
    for index in range(1, len(nudged)):
        if nudged[index][0] < nudged[index - 1][0] + gap:
            nudged[index][0] = nudged[index - 1][0] + gap
    overflow = nudged[-1][0] + 4 - (top + height)
    if overflow > 0:
        for item in nudged:
            item[0] -= overflow
    label_x = left + plot_width + 3
    pdf.set_font("Helvetica", "", 8)
    for label_y, title, value, color in nudged:
        pdf.set_draw_color(*color)
        pdf.set_line_width(0.3)
        pdf.line(left + plot_width, y_at(value), label_x - 1, label_y)
        pdf.set_text_color(*color)
        pdf.text(label_x, label_y, title)
        pdf.text(label_x, label_y + 3.5, _latin(_money(value)))

    pdf.set_y(top + height + 12)
