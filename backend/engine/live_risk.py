"""One-year stress test from live Yahoo Finance price history."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote

import numpy as np
import requests

from engine.equity_prices import yahoo_symbol

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_HEADERS = {"User-Agent": "Mozilla/5.0"}
LOOKBACK = "2y"
HORIZON_DAYS = 252
N_PATHS = 1000
MIN_HISTORY_DAYS = 60
YIELD_SHOCK = {
    "Rate_Shock": 2.0,
    "Stagflation": 1.0,
    "Soft_Landing": -1.0,
}

CLASS_MAP = {
    "equities": "Equities",
    "equity": "Equities",
    "stocks": "Equities",
    "stock": "Equities",
    "bonds": "Bonds",
    "bond": "Bonds",
    "fixed income": "Bonds",
    "real_assets": "Real_Assets",
    "real assets": "Real_Assets",
    "commodities": "Real_Assets",
    "commodity": "Real_Assets",
    "cash": "Cash",
}
CASH_TICKERS = {"CASH", "USD", "USD-CASH"}
PROXIES = ("SPY", "^TNX")


class LiveRiskError(Exception):
    pass


def asset_bucket(asset_class: str) -> str:
    return CLASS_MAP.get(str(asset_class).strip().lower(), "Equities")


def is_cash_holding(ticker: str, asset_class: str) -> bool:
    return asset_bucket(asset_class) == "Cash" or yahoo_symbol(ticker) in CASH_TICKERS


def fetch_daily_closes(symbol: str) -> dict[str, float]:
    safe = quote(yahoo_symbol(symbol), safe="")
    response = requests.get(
        YAHOO_CHART_URL.format(symbol=safe),
        params={"interval": "1d", "range": LOOKBACK},
        headers=_HEADERS,
        timeout=15,
    )
    if response.status_code != 200:
        return {}
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return {}
    block = result[0]
    timestamps = block.get("timestamp") or []
    indicators = block.get("indicators") or {}
    adj = (indicators.get("adjclose") or [{}])[0].get("adjclose")
    closes = (indicators.get("quote") or [{}])[0].get("close") or []
    series = adj if isinstance(adj, list) and any(value is not None for value in adj) else closes
    prices: dict[str, float] = {}
    for stamp, price in zip(timestamps, series):
        if price is None:
            continue
        price = float(price)
        if price <= 0:
            continue
        day = datetime.fromtimestamp(int(stamp), tz=timezone.utc).date().isoformat()
        prices[day] = price
    return prices


def _daily_returns(closes: dict[str, float]) -> dict[str, float]:
    days = sorted(closes)
    returns: dict[str, float] = {}
    for previous, day in zip(days, days[1:]):
        start = closes[previous]
        if start <= 0:
            continue
        returns[day] = closes[day] / start - 1.0
    return returns


def _beta(returns: np.ndarray, factor: np.ndarray) -> float:
    variance = float(np.var(factor))
    if variance <= 0:
        return 0.0
    return float(np.cov(returns, factor, ddof=0)[0, 1] / variance)


def _worst_window(returns: np.ndarray, window: int = 63) -> float:
    if len(returns) <= window:
        return float(np.prod(1.0 + returns) - 1.0)
    compounded = [
        float(np.prod(1.0 + returns[index:index + window]) - 1.0)
        for index in range(len(returns) - window)
    ]
    return min(compounded)


def _build_context(holdings: list[dict], cash_daily_return: float = 0.0) -> dict:
    if not holdings:
        raise LiveRiskError("This portfolio has no holdings. Upload a CSV first.")

    positions = []
    for holding in holdings:
        ticker = yahoo_symbol(holding["ticker"])
        quantity = float(holding["quantity"])
        if quantity <= 0:
            continue
        positions.append({
            "ticker": ticker,
            "asset_class": str(holding.get("asset_class") or ""),
            "bucket": asset_bucket(str(holding.get("asset_class") or "")),
            "quantity": quantity,
            "cash": is_cash_holding(ticker, str(holding.get("asset_class") or "")),
        })
    if not positions:
        raise LiveRiskError("This portfolio has no holdings. Upload a CSV first.")

    symbols = sorted({row["ticker"] for row in positions if not row["cash"]})
    if not symbols:
        raise LiveRiskError("Add a traded holding before running a live stress test. Cash alone has no price history.")

    needed = symbols + [proxy for proxy in PROXIES if proxy not in symbols]
    closes: dict[str, dict[str, float]] = {}
    workers = min(8, len(needed))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, series in zip(needed, pool.map(fetch_daily_closes, needed)):
            closes[symbol] = series

    missing = [symbol for symbol in symbols if len(closes.get(symbol, {})) < 2]
    if missing:
        raise LiveRiskError(f"Yahoo Finance has no price history for: {', '.join(missing)}")
    missing_proxies = [symbol for symbol in PROXIES if len(closes.get(symbol, {})) < 2]
    if missing_proxies:
        raise LiveRiskError(f"Yahoo Finance has no price history for: {', '.join(missing_proxies)}")

    returns = {symbol: _daily_returns(closes[symbol]) for symbol in symbols}
    spy = _daily_returns(closes["SPY"])
    tnx_levels = closes["^TNX"]
    tnx_days = sorted(tnx_levels)
    tnx_change = {
        day: tnx_levels[day] - tnx_levels[previous]
        for previous, day in zip(tnx_days, tnx_days[1:])
    }

    market_values: dict[str, float] = {}
    buckets: dict[str, str] = {}
    for row in positions:
        if row["cash"]:
            continue
        last_day = max(closes[row["ticker"]])
        market_values[row["ticker"]] = market_values.get(row["ticker"], 0.0) + row["quantity"] * closes[row["ticker"]][last_day]
        buckets[row["ticker"]] = row["bucket"]

    cash_value = 0.0
    for row in positions:
        if row["cash"]:
            cash_value += row["quantity"] * float(holding_price(row, holdings))

    common = set.intersection(*(set(series) for series in returns.values()))
    common &= set(spy) & set(tnx_change)
    days = sorted(common)
    if len(days) < MIN_HISTORY_DAYS:
        raise LiveRiskError("Not enough overlapping price history to price this portfolio.")

    invested = sum(market_values.values())
    total_value = invested + cash_value
    if total_value <= 0:
        raise LiveRiskError("This portfolio has no market value.")

    class_values = {"Equities": 0.0, "Bonds": 0.0, "Real_Assets": 0.0, "Cash": cash_value}
    for ticker, value in market_values.items():
        class_values[buckets[ticker]] += value

    yield_change = np.array([tnx_change[day] for day in days], dtype=float)
    spy_returns = np.array([spy[day] for day in days], dtype=float)
    ticker_returns: dict[str, np.ndarray] = {}
    quantities: dict[str, float] = {}
    classes: dict[str, str] = {}
    for row in positions:
        if row["cash"]:
            continue
        quantities[row["ticker"]] = quantities.get(row["ticker"], 0.0) + row["quantity"]
        classes[row["ticker"]] = row["asset_class"]
    for ticker in market_values:
        ticker_returns[ticker] = np.array([returns[ticker][day] for day in days], dtype=float)

    holding_rows = []
    for ticker, value in market_values.items():
        quantity = quantities[ticker]
        holding_rows.append({
            "ticker": ticker,
            "asset_class": classes.get(ticker, buckets[ticker]),
            "quantity": quantity,
            "price": value / quantity if quantity else 0.0,
            "market_value": value,
        })
    for row in positions:
        if not row["cash"]:
            continue
        price = float(holding_price(row, holdings))
        holding_rows.append({
            "ticker": row["ticker"],
            "asset_class": row["asset_class"] or "cash",
            "quantity": row["quantity"],
            "price": price,
            "market_value": row["quantity"] * price,
        })

    portfolio_returns = []
    for index, _day in enumerate(days):
        grown = cash_value * cash_daily_return
        for ticker, value in market_values.items():
            grown += value * float(ticker_returns[ticker][index])
        portfolio_returns.append(grown / total_value)
    sample = np.array(portfolio_returns, dtype=float)

    return {
        "total_value": total_value,
        "class_values": class_values,
        "market_values": market_values,
        "buckets": buckets,
        "ticker_returns": ticker_returns,
        "yield_change": yield_change,
        "spy_returns": spy_returns,
        "demeaned": sample - float(np.mean(sample)),
        "history_days": len(days),
        "holding_rows": holding_rows,
    }


def _apply_scenario(context: dict, scenario: str) -> dict:
    scenario_key = scenario if scenario in YIELD_SHOCK else "Rate_Shock"
    yield_shock = YIELD_SHOCK[scenario_key]
    growth_shock = _worst_window(context["spy_returns"]) if scenario_key == "Stagflation" else 0.0
    total_value = context["total_value"]
    ticker_impact: dict[str, float] = {}
    for ticker, series in context["ticker_returns"].items():
        impact = _beta(series, context["yield_change"]) * yield_shock
        if growth_shock:
            impact += _beta(series, context["spy_returns"]) * growth_shock
        ticker_impact[ticker] = impact

    impacts = {"Equities": 0.0, "Bonds": 0.0, "Real_Assets": 0.0, "Cash": 0.0}
    scenario_return = 0.0
    for ticker, value in context["market_values"].items():
        scenario_return += (value / total_value) * ticker_impact[ticker]
        impacts[context["buckets"][ticker]] += value * ticker_impact[ticker]
    for name, value in context["class_values"].items():
        if name == "Cash" or value <= 0:
            continue
        impacts[name] = round(impacts[name] / value * 100, 1)

    demeaned = context["demeaned"]
    daily_shock = scenario_return / HORIZON_DAYS
    draws = np.random.default_rng().integers(0, len(demeaned), size=(N_PATHS, HORIZON_DAYS))
    path_returns = np.prod(1.0 + demeaned[draws] + daily_shock, axis=1) - 1.0
    terminal = total_value * (1.0 + path_returns)
    var_95_loss = float(np.percentile(terminal, 5) - total_value)
    loss_ratio = abs(var_95_loss) / total_value
    return {
        "baseline_value": total_value,
        "mean_shocked_value": float(np.mean(terminal)),
        "var_95_loss": var_95_loss,
        "overall_score": int(min(100, max(0, round(loss_ratio * 400)))),
        "asset_impacts": impacts,
        "history_days": context["history_days"],
        "scenario_days": context["history_days"],
        "scenario": scenario_key,
        "paths": N_PATHS,
        "holding_rows": context["holding_rows"],
    }


def run_live_stress(holdings: list[dict], scenario: str, cash_daily_return: float = 0.0) -> dict:
    scenario_key = scenario if scenario in YIELD_SHOCK else "Rate_Shock"
    return _apply_scenario(_build_context(holdings, cash_daily_return), scenario_key)


def run_all_scenarios(holdings: list[dict], cash_daily_return: float = 0.0) -> list[dict]:
    context = _build_context(holdings, cash_daily_return)
    return [_apply_scenario(context, scenario) for scenario in ("Rate_Shock", "Stagflation", "Soft_Landing")]


def holding_price(position: dict, holdings: list[dict]) -> float:
    ticker = position["ticker"]
    for holding in holdings:
        if yahoo_symbol(holding["ticker"]) == ticker:
            price = float(holding.get("current_price") or 0)
            if price > 0:
                return price
    return 1.0
