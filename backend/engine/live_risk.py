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
MIN_R_SQUARED = 0.05
WEEK_DAYS = 5
MIN_WEEKS = 30
FALLBACK_NOTE_WEIGHT = 0.20
EQUITY_BETA_FLOOR = 0.5
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
    "alternatives": "Unclassified",
    "alternative": "Unclassified",
    "private credit": "Unclassified",
    "private_credit": "Unclassified",
    "hedge fund": "Unclassified",
    "other": "Unclassified",
}
CASH_TICKERS = {"CASH", "USD", "USD-CASH"}
PROXIES = ("SPY", "^TNX")
BOND_PROXY = "AGG"
COMMODITY_PROXY = "DBC"
FACTOR_PROXIES = (BOND_PROXY, COMMODITY_PROXY)
FALLBACK_LABELS = {
    "spy": "S&P 500 proxy",
    "duration": "stored duration",
    "bond_proxy": "AGG bond proxy",
    "commodity_proxy": "DBC commodity proxy",
    "equity_floor": "0.5 equity floor",
}


class LiveRiskError(Exception):
    pass


def asset_bucket(asset_class: str) -> str:
    return CLASS_MAP.get(str(asset_class).strip().lower(), "Unclassified")


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


def _fit_factors(
    returns: np.ndarray,
    factors: list[np.ndarray],
    min_observations: int = MIN_HISTORY_DAYS,
) -> dict | None:
    """OLS slope on each factor. Usable when the fit explains a material share of variance."""
    sample = np.asarray(returns, dtype=float)
    n = len(sample)
    if n < min_observations:
        return None
    columns = [np.ones(n)]
    for factor in factors:
        values = np.asarray(factor, dtype=float)
        if len(values) != n or float(np.var(values)) <= 0:
            return None
        columns.append(values)
    design = np.column_stack(columns)
    coefficients, _, rank, _ = np.linalg.lstsq(design, sample, rcond=None)
    if int(rank) < design.shape[1]:
        return None
    residual = sample - design @ coefficients
    centered = sample - float(np.mean(sample))
    ss_tot = float(centered @ centered)
    r_squared = 0.0 if ss_tot <= 0 else 1.0 - float(residual @ residual) / ss_tot
    return {
        "betas": [float(coefficients[index]) for index in range(1, len(coefficients))],
        "r_squared": r_squared,
        "usable": r_squared >= MIN_R_SQUARED,
    }


def _aligned_proxy(closes: dict[str, float], days: list[str]) -> dict | None:
    returns = _daily_returns(closes)
    index = [position for position, day in enumerate(days) if day in returns]
    if len(index) < MIN_HISTORY_DAYS:
        return None
    positions = np.array(index, dtype=int)
    values = np.array([returns[days[position]] for position in index], dtype=float)
    return {"returns": values, "index": positions}


def _yield_decimal(tnx_level: float) -> float:
    """Yahoo ^TNX is a percent yield, or the legacy quote at ten times the yield."""
    percent = tnx_level / 10.0 if tnx_level > 20.0 else tnx_level
    return percent / 100.0


def _par_bond_curve(maturity_years: float, yield_decimal: float, frequency: int = 2) -> tuple[float, float]:
    """Macaulay duration in years, and convexity, for a par bond.

    Convexity is d²P/dy² / P with the annual yield in decimal, so it matches
    dP/P = -D_mod·dy + ½·C·dy².
    """
    periods = max(1, int(round(maturity_years * frequency)))
    periodic = yield_decimal / frequency
    growth = 1.0 + periodic
    price = 0.0
    weighted_time = 0.0
    weighted_convex = 0.0
    for step in range(1, periods + 1):
        cash = periodic if step < periods else 1.0 + periodic
        present = cash / growth ** step
        years = step / frequency
        price += present
        weighted_time += years * present
        weighted_convex += years * (years + 1.0 / frequency) * present
    if price <= 0:
        return 0.0, 0.0
    return weighted_time / price, weighted_convex / (price * growth ** 2)


def _convexity_for_modified_duration(modified_duration: float, yield_decimal: float, frequency: int = 2) -> float:
    """Convexity of the par bond whose modified duration matches this holding."""
    yield_level = min(0.20, max(float(yield_decimal), 0.005))
    macaulay = modified_duration * (1.0 + yield_level / frequency)
    bullet = macaulay * (macaulay + 1.0 / frequency) / (1.0 + yield_level / frequency) ** 2
    low = 1.0 / frequency
    high = 100.0
    low_duration, _ = _par_bond_curve(low, yield_level, frequency)
    high_duration, high_convexity = _par_bond_curve(high, yield_level, frequency)
    if macaulay <= low_duration:
        return bullet
    if macaulay >= high_duration:
        return high_convexity if macaulay == high_duration else bullet
    convexity = high_convexity
    for _ in range(60):
        mid = 0.5 * (low + high)
        duration, convexity = _par_bond_curve(mid, yield_level, frequency)
        if duration < macaulay:
            low = mid
        else:
            high = mid
    return convexity


def _bond_cut_return(
    returns: np.ndarray,
    yield_change: np.ndarray,
    modified_duration: float,
    yield_decimal: float,
    yield_shock: float,
) -> float | None:
    """Price change for a rate move, using modified duration and convexity.

    A stored duration is the holding's effective duration. Otherwise the
    effective duration is the local price-yield slope. The curvature is the
    par bond with that duration, so a cut is not priced as a straight line.
    """
    duration = float(modified_duration)
    if duration <= 0:
        duration = -100.0 * _beta(returns, yield_change)
        if not 0.0 < duration <= 40.0:
            return None
    return _duration_return(duration, yield_decimal, yield_shock)


def _duration_return(duration: float, yield_decimal: float, yield_shock: float) -> float:
    delta_yield = yield_shock / 100.0
    convexity = _convexity_for_modified_duration(duration, yield_decimal)
    return -duration * delta_yield + 0.5 * convexity * delta_yield ** 2


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
            "duration_years": float(holding.get("duration_years") or 0.0),
        })
    if not positions:
        raise LiveRiskError("This portfolio has no holdings. Upload a CSV first.")

    symbols = sorted({row["ticker"] for row in positions if not row["cash"]})
    if not symbols:
        raise LiveRiskError("Add a traded holding before running a live stress test. Cash alone has no price history.")

    optional = [symbol for symbol in FACTOR_PROXIES if symbol not in symbols and symbol not in PROXIES]
    needed = symbols + [proxy for proxy in PROXIES if proxy not in symbols] + optional
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
    duration_value: dict[str, float] = {}
    duration_weight: dict[str, float] = {}
    for row in positions:
        if row["cash"]:
            continue
        last_day = max(closes[row["ticker"]])
        value = row["quantity"] * closes[row["ticker"]][last_day]
        market_values[row["ticker"]] = market_values.get(row["ticker"], 0.0) + value
        if row["duration_years"] > 0:
            duration_value[row["ticker"]] = duration_value.get(row["ticker"], 0.0) + value * row["duration_years"]
            duration_weight[row["ticker"]] = duration_weight.get(row["ticker"], 0.0) + value
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

    class_values = {
        "Equities": 0.0,
        "Bonds": 0.0,
        "Real_Assets": 0.0,
        "Unclassified": 0.0,
        "Cash": cash_value,
    }
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

    proxy_samples: dict[str, dict] = {}
    for symbol in FACTOR_PROXIES:
        if symbol in ticker_returns:
            proxy_samples[symbol] = {
                "returns": ticker_returns[symbol],
                "index": np.arange(len(days), dtype=int),
            }
            continue
        sample = _aligned_proxy(closes.get(symbol) or {}, days)
        if sample:
            proxy_samples[symbol] = sample

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
        "yield_decimal": _yield_decimal(tnx_levels[tnx_days[-1]]),
        "durations": {
            ticker: duration_value[ticker] / duration_weight[ticker]
            for ticker in duration_weight
            if duration_weight[ticker] > 0
        },
        "spy_returns": spy_returns,
        "proxy_samples": proxy_samples,
        "demeaned": sample - float(np.mean(sample)),
        "history_days": len(days),
        "history_start": days[0],
        "history_end": days[-1],
        "cash_daily_return": cash_daily_return,
        "holding_rows": holding_rows,
    }


def _block(values: np.ndarray, how: str) -> np.ndarray | None:
    """Non-overlapping weeks, keeping the most recent days. Yield changes add; returns compound."""
    count = len(values) // WEEK_DAYS
    if count < MIN_WEEKS:
        return None
    trimmed = np.asarray(values, dtype=float)[-count * WEEK_DAYS:]
    shaped = trimmed.reshape(count, WEEK_DAYS)
    if how == "sum":
        return shaped.sum(axis=1)
    return np.prod(1.0 + shaped, axis=1) - 1.0


def _partial_yield_fit(returns: np.ndarray, yield_change: np.ndarray, market: np.ndarray) -> dict | None:
    """Yield beta after removing the market. Weekly when the history is long enough."""
    weekly_returns = _block(returns, "compound")
    weekly_yield = _block(yield_change, "sum")
    weekly_market = _block(market, "compound")
    if weekly_returns is not None and weekly_yield is not None and weekly_market is not None:
        fit = _fit_factors(weekly_returns, [weekly_yield, weekly_market], MIN_WEEKS)
        if fit and fit["usable"]:
            fit["frequency"] = "weekly"
            return fit
    fit = _fit_factors(returns, [yield_change, market])
    if fit:
        fit["frequency"] = "daily"
    return fit


def _proxy_fits(context: dict, two_factor: bool) -> dict[str, dict | None]:
    yield_change = context["yield_change"]
    market = context["spy_returns"]
    fits: dict[str, dict | None] = {
        "SPY": _fit_factors(market, [yield_change]),
    }
    for symbol, sample in (context.get("proxy_samples") or {}).items():
        index = sample["index"]
        factors = [yield_change[index]]
        if two_factor:
            factors.append(market[index])
        fits[symbol] = _fit_factors(sample["returns"], factors)
    return fits


def _from_fit(fit: dict | None, yield_shock: float, growth_shock: float) -> float | None:
    if not fit:
        return None
    impact = fit["betas"][0] * yield_shock
    if len(fit["betas"]) > 1:
        impact += fit["betas"][1] * growth_shock
    return impact


def _equity_floor(spy_fit: dict | None, yield_shock: float, growth_shock: float) -> float:
    yield_beta = spy_fit["betas"][0] if spy_fit else 0.0
    return EQUITY_BETA_FLOOR * yield_beta * yield_shock + EQUITY_BETA_FLOOR * growth_shock


def _class_fallback(
    bucket: str,
    ticker: str,
    context: dict,
    fits: dict[str, dict | None],
    yield_shock: float,
    growth_shock: float,
) -> tuple[float, str]:
    spy_fit = fits.get("SPY")
    if bucket == "Equities":
        yield_beta = spy_fit["betas"][0] if spy_fit else 0.0
        return yield_beta * yield_shock + growth_shock, "spy"
    if bucket == "Bonds":
        duration = float(context["durations"].get(ticker, 0.0))
        if duration > 0:
            impact = _duration_return(duration, context["yield_decimal"], yield_shock)
            bond_fit = fits.get(BOND_PROXY)
            if growth_shock and bond_fit and len(bond_fit["betas"]) > 1:
                impact += bond_fit["betas"][1] * growth_shock
            return impact, "duration"
        proxied = _from_fit(fits.get(BOND_PROXY), yield_shock, growth_shock)
        if proxied is not None:
            return proxied, "bond_proxy"
        return _equity_floor(spy_fit, yield_shock, growth_shock), "equity_floor"
    if bucket == "Real_Assets":
        proxied = _from_fit(fits.get(COMMODITY_PROXY), yield_shock, growth_shock)
        if proxied is not None:
            return proxied, "commodity_proxy"
        return _equity_floor(spy_fit, yield_shock, growth_shock), "equity_floor"
    return _equity_floor(spy_fit, yield_shock, growth_shock), "equity_floor"


def _holding_impact(
    ticker: str,
    series: np.ndarray,
    context: dict,
    fits: dict[str, dict | None],
    scenario_key: str,
    yield_shock: float,
    growth_shock: float,
) -> tuple[float, str]:
    """Return the holding's price impact and a fallback method, or an empty method when its own fit is used."""
    bucket = context["buckets"].get(ticker, "Unclassified")
    yield_change = context["yield_change"]
    if scenario_key == "Soft_Landing" and bucket == "Bonds":
        duration = float(context["durations"].get(ticker, 0.0))
        if duration > 0:
            return _duration_return(duration, context["yield_decimal"], yield_shock), ""
        fit = _fit_factors(series, [yield_change])
        if fit and fit["usable"]:
            priced = _bond_cut_return(series, yield_change, 0.0, context["yield_decimal"], yield_shock)
            if priced is not None:
                return priced, ""
        return _class_fallback(bucket, ticker, context, fits, yield_shock, growth_shock)
    if scenario_key == "Stagflation":
        fit = _fit_factors(series, [yield_change, context["spy_returns"]])
        if fit and fit["usable"]:
            return fit["betas"][0] * yield_shock + fit["betas"][1] * growth_shock, ""
        return _class_fallback(bucket, ticker, context, fits, yield_shock, growth_shock)
    if bucket == "Equities":
        fit = _partial_yield_fit(series, yield_change, context["spy_returns"])
        if fit and fit["usable"]:
            return fit["betas"][0] * yield_shock, ""
        return _class_fallback(bucket, ticker, context, fits, yield_shock, growth_shock)
    fit = _fit_factors(series, [yield_change])
    if fit and fit["usable"]:
        return fit["betas"][0] * yield_shock, ""
    return _class_fallback(bucket, ticker, context, fits, yield_shock, growth_shock)


def _custom_copy(yield_shock: float, growth_shock: float, use_worst_equity_window: bool) -> tuple[str, str, str]:
    """Label, advisor note, and client sentence for a shock that is not a named preset."""
    bps = yield_shock * 100.0
    if use_worst_equity_window:
        label = f"Custom shock ({bps:+.0f} bp, worst 3-month S&P)"
        note = (
            f"Yields move {bps:+.0f} basis points, and the worst three-month S&P move "
            f"in the price history ({growth_shock * 100:+.1f}%) is applied through each holding's "
            "partial betas to yields and the market. Both shocks reprice the book immediately. "
            "The following year resamples historical variation around that new value."
        )
        client = "Yields move and markets follow the worst three-month stretch in this history."
        return label, note, client
    if abs(growth_shock) > 1e-12:
        label = f"Custom shock ({bps:+.0f} bp, S&P {growth_shock * 100:+.1f}%)"
        note = (
            f"Yields move {bps:+.0f} basis points and the S&P moves {growth_shock * 100:+.1f}%. "
            "Each holding is repriced with its partial betas to the 10-year and the S&P. "
            "The following year resamples historical variation around that new value."
        )
        if abs(yield_shock) < 1e-12:
            client = f"The S&P moves {growth_shock * 100:+.1f}%."
        else:
            client = (
                f"Yields move by {abs(yield_shock):.2f} percentage points"
                f"{' higher' if yield_shock > 0 else ' lower'} "
                f"and the S&P moves {growth_shock * 100:+.1f}%."
            )
        return label, note, client
    label = f"Custom shock ({bps:+.0f} bp)"
    if yield_shock < 0:
        note = (
            f"Yields move {bps:+.0f} basis points and reprice the book immediately. "
            "Bonds use modified duration and convexity. Equities use a market-controlled yield beta. "
            "Cash is not repriced. The following year resamples historical variation around that new value."
        )
    else:
        note = (
            f"Yields move {bps:+.0f} basis points and reprice the book immediately. "
            "Equity sensitivity is the partial beta to the 10-year after controlling for the S&P. "
            "The following year resamples historical variation around that new value."
        )
    direction = "rise" if yield_shock > 0 else "fall" if yield_shock < 0 else "do not move"
    client = f"Interest rates {direction} by {abs(yield_shock):.2f} percentage points."
    return label, note, client


def _resolve_shock(
    context: dict,
    scenario: str,
    yield_bps: float | None,
    equity_pct: float | None,
    use_worst_equity_window: bool,
) -> tuple[str, float, float, bool, str]:
    """Scenario name, yield move in percentage points, S&P move, worst-window flag, pricing path.

    A pair that matches a preset keeps that preset's name so the report does not repeat it.
    Any other pair is Custom and is priced on the preset path that uses the same channels.
    """
    custom_request = (
        scenario == "Custom"
        or yield_bps is not None
        or equity_pct is not None
        or use_worst_equity_window
    )
    if not custom_request:
        scenario_key = scenario if scenario in YIELD_SHOCK else "Rate_Shock"
        yield_shock = YIELD_SHOCK[scenario_key]
        growth_shock = _worst_window(context["spy_returns"]) if scenario_key == "Stagflation" else 0.0
        return scenario_key, yield_shock, growth_shock, scenario_key == "Stagflation", scenario_key

    if yield_bps is None and equity_pct is None and not use_worst_equity_window:
        raise LiveRiskError("Set a yield move, an S&P move, or both.")

    yield_shock = round(float(yield_bps or 0.0), 1) / 100.0
    if use_worst_equity_window:
        growth_shock = _worst_window(context["spy_returns"])
        if abs(yield_shock - YIELD_SHOCK["Stagflation"]) < 1e-6:
            return "Stagflation", yield_shock, growth_shock, True, "Stagflation"
        return "Custom", yield_shock, growth_shock, True, "Stagflation"

    growth_shock = round(float(equity_pct or 0.0), 2) / 100.0
    if abs(growth_shock) < 1e-12 and abs(yield_shock - YIELD_SHOCK["Rate_Shock"]) < 1e-6:
        return "Rate_Shock", yield_shock, 0.0, False, "Rate_Shock"
    if abs(growth_shock) < 1e-12 and abs(yield_shock - YIELD_SHOCK["Soft_Landing"]) < 1e-6:
        return "Soft_Landing", yield_shock, 0.0, False, "Soft_Landing"
    pricing_key = "Stagflation" if abs(growth_shock) >= 1e-12 else "Soft_Landing" if yield_shock < 0 else "Rate_Shock"
    return "Custom", yield_shock, growth_shock, False, pricing_key


def _apply_scenario(
    context: dict,
    scenario: str,
    yield_bps: float | None = None,
    equity_pct: float | None = None,
    use_worst_equity_window: bool = False,
) -> dict:
    scenario_key, yield_shock, growth_shock, use_worst, pricing_key = _resolve_shock(
        context,
        scenario,
        yield_bps,
        equity_pct,
        use_worst_equity_window,
    )
    total_value = context["total_value"]
    fits = _proxy_fits(context, pricing_key == "Stagflation")
    ticker_impact: dict[str, float] = {}
    fallback_rows = []
    for ticker, series in context["ticker_returns"].items():
        impact, method = _holding_impact(
            ticker,
            series,
            context,
            fits,
            pricing_key,
            yield_shock,
            growth_shock,
        )
        ticker_impact[ticker] = impact
        if method:
            fallback_rows.append({
                "ticker": ticker,
                "method": method,
                "method_label": FALLBACK_LABELS[method],
                "weight": context["market_values"][ticker] / total_value,
            })

    impacts = {"Equities": 0.0, "Bonds": 0.0, "Real_Assets": 0.0, "Unclassified": 0.0, "Cash": 0.0}
    scenario_return = 0.0
    for ticker, value in context["market_values"].items():
        scenario_return += (value / total_value) * ticker_impact[ticker]
        impacts[context["buckets"][ticker]] += value * ticker_impact[ticker]
    for name, value in context["class_values"].items():
        if name == "Cash" or value <= 0:
            continue
        impacts[name] = round(impacts[name] / value * 100, 1)

    cash_weight = context["class_values"].get("Cash", 0.0) / total_value if total_value else 0.0
    cash_note = ""
    if cash_weight >= 0.005:
        cash_note = (
            f"Cash is {cash_weight * 100:.1f}% of the book and is not repriced, "
            "so it damps the portfolio impact."
        )

    fallback_rows.sort(key=lambda row: row["ticker"])
    fallback_weight = sum(row["weight"] for row in fallback_rows)
    fallback_note = ""
    if fallback_weight >= FALLBACK_NOTE_WEIGHT:
        fallback_note = (
            f"{fallback_weight * 100:.0f}% of the book is priced from a class fallback "
            "because its own price history does not explain moves in yields and the S&P."
        )

    demeaned = context["demeaned"]
    draws = np.random.default_rng().integers(0, len(demeaned), size=(N_PATHS, HORIZON_DAYS))
    sampled = demeaned[draws]
    shocked_start = total_value * (1.0 + scenario_return)
    terminal = shocked_start * np.prod(1.0 + sampled, axis=1)
    var_95_loss = float(np.percentile(terminal, 5) - total_value)
    loss_ratio = abs(var_95_loss) / total_value
    shock_label = ""
    shock_note = ""
    client_note = ""
    if scenario_key == "Custom":
        shock_label, shock_note, client_note = _custom_copy(yield_shock, growth_shock, use_worst)
    return {
        "baseline_value": total_value,
        "mean_shocked_value": float(np.mean(terminal)),
        "var_95_loss": var_95_loss,
        "overall_score": int(min(100, max(0, round(loss_ratio * 400)))),
        "asset_impacts": impacts,
        "class_values": context["class_values"],
        "history_days": context["history_days"],
        "history_start": context["history_start"],
        "history_end": context["history_end"],
        "scenario_days": context["history_days"],
        "scenario": scenario_key,
        "paths": N_PATHS,
        "horizon_days": HORIZON_DAYS,
        "yield_shock": yield_shock,
        "growth_shock": growth_shock,
        "use_worst_equity_window": use_worst,
        "shock_label": shock_label,
        "shock_note": shock_note,
        "client_note": client_note,
        "cash_daily_return": context["cash_daily_return"],
        "holding_rows": context["holding_rows"],
        "portfolio_impact": round(scenario_return * 100, 1),
        "cash_weight": cash_weight,
        "cash_note": cash_note,
        "fallback_holdings": fallback_rows,
        "fallback_weight": fallback_weight,
        "fallback_note": fallback_note,
    }


def run_live_stress(
    holdings: list[dict],
    scenario: str,
    cash_daily_return: float = 0.0,
    yield_bps: float | None = None,
    equity_pct: float | None = None,
    use_worst_equity_window: bool = False,
) -> dict:
    return _apply_scenario(
        _build_context(holdings, cash_daily_return),
        scenario,
        yield_bps,
        equity_pct,
        use_worst_equity_window,
    )


def run_all_scenarios(
    holdings: list[dict],
    cash_daily_return: float = 0.0,
    yield_bps: float | None = None,
    equity_pct: float | None = None,
    use_worst_equity_window: bool = False,
) -> list[dict]:
    context = _build_context(holdings, cash_daily_return)
    results = [_apply_scenario(context, scenario) for scenario in ("Rate_Shock", "Stagflation", "Soft_Landing")]
    if yield_bps is not None or equity_pct is not None or use_worst_equity_window:
        custom = _apply_scenario(context, "Custom", yield_bps, equity_pct, use_worst_equity_window)
        if custom["scenario"] == "Custom":
            results.append(custom)
    return results


def live_starting_value(holdings: list[dict]) -> float:
    """Mark the book at the latest Yahoo close. Cash keeps its stored price."""
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
            "quantity": quantity,
            "cash": is_cash_holding(ticker, str(holding.get("asset_class") or "")),
        })
    if not positions:
        raise LiveRiskError("This portfolio has no holdings. Upload a CSV first.")

    symbols = sorted({row["ticker"] for row in positions if not row["cash"]})
    closes: dict[str, dict[str, float]] = {}
    if symbols:
        workers = min(8, len(symbols))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for symbol, series in zip(symbols, pool.map(fetch_daily_closes, symbols)):
                closes[symbol] = series
        missing = [symbol for symbol in symbols if not closes.get(symbol)]
        if missing:
            raise LiveRiskError(f"Yahoo Finance has no price for: {', '.join(missing)}")

    total = 0.0
    for row in positions:
        if row["cash"]:
            total += row["quantity"] * float(holding_price(row, holdings))
            continue
        last_day = max(closes[row["ticker"]])
        total += row["quantity"] * closes[row["ticker"]][last_day]
    if total <= 0:
        raise LiveRiskError("This portfolio has no market value.")
    return total


def holding_price(position: dict, holdings: list[dict]) -> float:
    ticker = position["ticker"]
    for holding in holdings:
        if yahoo_symbol(holding["ticker"]) == ticker:
            price = float(holding.get("current_price") or 0)
            if price > 0:
                return price
    return 1.0
