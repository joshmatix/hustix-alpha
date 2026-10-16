"""Scenario math that does not need a live price feed."""

import numpy as np

import pytest

from engine.live_risk import (
    LiveRiskError,
    _apply_scenario,
    _beta,
    _duration_return,
    _fit_factors,
    _partial_yield_fit,
    _worst_window,
    asset_bucket,
)


def _portfolio(series, bucket, spy, yield_change, duration=0.0, proxy_samples=None, weight=1.0, extra=None, cash=0.0):
    series = np.asarray(series, dtype=float)
    spy = np.asarray(spy, dtype=float)
    yield_change = np.asarray(yield_change, dtype=float)
    total = 1_000_000.0
    invested = total - cash
    holdings = {"TEST": weight * invested}
    buckets = {"TEST": bucket}
    returns = {"TEST": series}
    durations = {"TEST": duration} if duration else {}
    if extra:
        holdings.update(extra["market_values"])
        buckets.update(extra["buckets"])
        returns.update(extra["returns"])
        durations.update(extra.get("durations") or {})
    classes = {"Equities": 0.0, "Bonds": 0.0, "Real_Assets": 0.0, "Unclassified": 0.0, "Cash": cash}
    for ticker, value in holdings.items():
        classes[buckets[ticker]] += value
    return {
        "total_value": total,
        "class_values": classes,
        "market_values": holdings,
        "buckets": buckets,
        "ticker_returns": returns,
        "yield_change": yield_change,
        "yield_decimal": 0.04,
        "durations": durations,
        "spy_returns": spy,
        "proxy_samples": proxy_samples or {},
        "demeaned": np.zeros(len(spy)),
        "history_days": len(spy),
        "history_start": "2024-01-02",
        "history_end": "2024-04-30",
        "cash_daily_return": 0.0,
        "holding_rows": [],
    }


def _market(seed=7):
    rng = np.random.default_rng(seed)
    n = 80
    spy = rng.normal(0, 0.01, n)
    spy[:63] = -0.008
    yield_change = rng.normal(0, 0.02, n)
    return spy, yield_change


def test_unknown_class_is_unclassified():
    assert asset_bucket("private credit") == "Unclassified"
    assert asset_bucket("not-a-class") == "Unclassified"
    assert asset_bucket("") == "Unclassified"
    assert asset_bucket("equities") == "Equities"


def test_stagflation_uses_partial_betas_and_reprices_once():
    rng = np.random.default_rng(7)
    n = 80
    spy = rng.normal(0, 0.01, n)
    spy[:63] = -0.01
    yield_change = 0.4 * spy + rng.normal(0, 0.002, n)
    series = spy.copy()
    result = _apply_scenario(_portfolio(series, "Equities", spy, yield_change), "Stagflation")
    growth = _worst_window(spy)
    impact = result["portfolio_impact"] / 100.0
    assert abs(impact - growth) < 0.005
    univariate = _beta(series, yield_change) * 1.0 + _beta(series, spy) * growth
    assert abs(impact - univariate) > 0.02
    assert result["fallback_holdings"] == []
    assert abs(result["mean_shocked_value"] - 1_000_000.0 * (1.0 + growth)) < 1.0


def test_flat_equity_falls_back_to_the_market_move():
    spy, yield_change = _market()
    result = _apply_scenario(_portfolio(np.zeros(len(spy)), "Equities", spy, yield_change), "Stagflation")
    growth = _worst_window(spy)
    yield_beta = _fit_factors(spy, [yield_change])["betas"][0]
    expected = yield_beta * 1.0 + growth
    assert result["fallback_holdings"][0]["method"] == "spy"
    assert abs(result["portfolio_impact"] / 100.0 - expected) < 0.005


def test_equity_fallback_keeps_the_market_yield_beta():
    rng = np.random.default_rng(11)
    n = 80
    yield_change = rng.normal(0, 0.02, n)
    spy = 0.25 * yield_change
    spy[:63] -= 0.01
    result = _apply_scenario(_portfolio(np.zeros(n), "Equities", spy, yield_change), "Stagflation")
    growth = _worst_window(spy)
    yield_beta = _fit_factors(spy, [yield_change])["betas"][0]
    assert abs(yield_beta) > 0.05
    expected = yield_beta + growth
    assert abs(result["portfolio_impact"] / 100.0 - expected) < 0.005
    assert abs((result["portfolio_impact"] / 100.0) - growth) > 0.02


def test_unclassified_uses_equity_floor_and_warns():
    spy, yield_change = _market()
    result = _apply_scenario(_portfolio(np.zeros(len(spy)), "Unclassified", spy, yield_change), "Stagflation")
    growth = _worst_window(spy)
    yield_beta = _fit_factors(spy, [yield_change])["betas"][0]
    expected = 0.5 * yield_beta + 0.5 * growth
    assert result["fallback_holdings"][0]["method"] == "equity_floor"
    assert abs(result["portfolio_impact"] / 100.0 - expected) < 0.005
    assert result["fallback_weight"] == 1.0
    assert result["fallback_note"].startswith("100%")
    assert result["asset_impacts"]["Unclassified"] < 0


def test_flat_bond_uses_stored_duration():
    spy, yield_change = _market()
    result = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Bonds", spy, yield_change, duration=10),
        "Stagflation",
    )
    priced = _duration_return(10, 0.04, 1.0)
    assert priced < 0
    assert result["fallback_holdings"][0]["method"] == "duration"
    assert abs(result["portfolio_impact"] / 100.0 - priced) < 0.005


def test_duration_fallback_adds_bond_proxy_equity_beta():
    spy, yield_change = _market()
    proxy = {"AGG": {"returns": 0.4 * spy, "index": np.arange(len(spy))}}
    result = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Bonds", spy, yield_change, duration=10, proxy_samples=proxy),
        "Stagflation",
    )
    growth = _worst_window(spy)
    priced = _duration_return(10, 0.04, 1.0) + 0.4 * growth
    assert result["fallback_holdings"][0]["method"] == "duration"
    assert abs(result["portfolio_impact"] / 100.0 - priced) < 0.01


def test_real_asset_uses_commodity_proxy():
    spy, yield_change = _market()
    proxy = {"DBC": {"returns": 0.7 * spy, "index": np.arange(len(spy))}}
    result = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Real_Assets", spy, yield_change, proxy_samples=proxy),
        "Stagflation",
    )
    growth = _worst_window(spy)
    assert result["fallback_holdings"][0]["method"] == "commodity_proxy"
    assert abs(result["portfolio_impact"] / 100.0 - 0.7 * growth) < 0.01


def test_missing_commodity_proxy_uses_equity_floor():
    spy, yield_change = _market()
    result = _apply_scenario(_portfolio(np.zeros(len(spy)), "Real_Assets", spy, yield_change), "Stagflation")
    growth = _worst_window(spy)
    yield_beta = _fit_factors(spy, [yield_change])["betas"][0]
    expected = 0.5 * yield_beta + 0.5 * growth
    assert result["fallback_holdings"][0]["method"] == "equity_floor"
    assert abs(result["portfolio_impact"] / 100.0 - expected) < 0.005


def test_rate_shock_keeps_the_yield_regression_and_reprices_once():
    rng = np.random.default_rng(4)
    n = 80
    yield_change = rng.normal(0, 0.03, n)
    spy = rng.normal(0, 0.01, n)
    series = 0.8 * yield_change
    result = _apply_scenario(_portfolio(series, "Equities", spy, yield_change), "Rate_Shock")
    expected = 1.6
    assert result["growth_shock"] == 0.0
    assert result["fallback_holdings"] == []
    assert abs(result["portfolio_impact"] / 100.0 - expected) < 0.005
    assert abs(result["mean_shocked_value"] - 1_000_000.0 * (1.0 + expected)) < 1.0


def test_rate_shock_flat_equity_uses_market_yield_beta():
    rng = np.random.default_rng(5)
    n = 80
    yield_change = rng.normal(0, 0.03, n)
    spy = 0.05 * yield_change
    result = _apply_scenario(_portfolio(np.zeros(n), "Equities", spy, yield_change), "Rate_Shock")
    assert result["fallback_holdings"][0]["method"] == "spy"
    assert abs(result["portfolio_impact"] / 100.0 - 0.10) < 0.005


def test_soft_landing_duration_is_the_model_not_a_fallback():
    spy, yield_change = _market()
    result = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Bonds", spy, yield_change, duration=8),
        "Soft_Landing",
    )
    priced = _duration_return(8, 0.04, -1.0)
    assert priced > 0
    assert result["fallback_holdings"] == []
    assert abs(result["portfolio_impact"] / 100.0 - priced) < 0.005
    assert abs(result["mean_shocked_value"] - 1_000_000.0 * (1.0 + priced)) < 1.0


def test_soft_landing_equity_yield_beta_controls_for_the_market():
    rng = np.random.default_rng(3)
    n = 80
    spy = rng.normal(0, 0.01, n)
    yield_change = 0.4 * spy + rng.normal(0, 0.002, n)
    result = _apply_scenario(_portfolio(spy, "Equities", spy, yield_change), "Soft_Landing")
    univariate = _beta(spy, yield_change) * -1.0
    assert abs(univariate) > 0.05
    assert abs(result["portfolio_impact"] / 100.0) < 0.01
    assert result["fallback_holdings"] == []
    assert result["cash_note"] == ""


def test_long_history_estimates_the_equity_yield_beta_weekly():
    rng = np.random.default_rng(9)
    n = 200
    spy = rng.normal(0, 0.01, n)
    yield_change = 0.5 * spy + rng.normal(0, 0.001, n)
    fit = _partial_yield_fit(spy, yield_change, spy)
    assert fit["frequency"] == "weekly"
    assert abs(fit["betas"][0]) < 0.05
    assert abs(_beta(spy, yield_change)) > 0.2


def test_cash_is_unshocked_and_damps_the_portfolio():
    rng = np.random.default_rng(4)
    n = 80
    yield_change = rng.normal(0, 0.03, n)
    spy = rng.normal(0, 0.01, n)
    series = 0.8 * yield_change
    result = _apply_scenario(
        _portfolio(series, "Equities", spy, yield_change, cash=200_000.0),
        "Rate_Shock",
    )
    assert abs(result["portfolio_impact"] / 100.0 - 1.28) < 0.01
    assert result["asset_impacts"]["Cash"] == 0.0
    assert result["cash_note"] == (
        "Cash is 20.0% of the portfolio and is not repriced, so it damps the portfolio impact."
    )


def test_fallback_note_starts_at_one_fifth_of_the_portfolio():
    spy, yield_change = _market()
    equity = spy.copy()

    def mixed(share):
        return _portfolio(
            np.zeros(len(spy)),
            "Unclassified",
            spy,
            yield_change,
            weight=share,
            extra={
                "market_values": {"SPY": (1.0 - share) * 1_000_000.0},
                "buckets": {"SPY": "Equities"},
                "returns": {"SPY": equity},
            },
        )

    small = _apply_scenario(mixed(0.15), "Stagflation")
    assert [row["ticker"] for row in small["fallback_holdings"]] == ["TEST"]
    assert small["fallback_note"] == ""

    large = _apply_scenario(mixed(0.25), "Stagflation")
    assert large["fallback_note"].startswith("25%")


def test_custom_pair_that_matches_a_preset_keeps_the_preset_name():
    spy, yield_change = _market()
    portfolio = _portfolio(spy, "Equities", spy, yield_change)
    named = _apply_scenario(portfolio, "Rate_Shock")
    filled = _apply_scenario(portfolio, "Custom", yield_bps=200, equity_pct=0)
    assert filled["scenario"] == "Rate_Shock"
    assert filled["shock_label"] == ""
    assert filled["portfolio_impact"] == named["portfolio_impact"]

    cut = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Bonds", spy, yield_change, duration=8),
        "Custom",
        yield_bps=-100,
        equity_pct=0,
    )
    assert cut["scenario"] == "Soft_Landing"

    window = _apply_scenario(portfolio, "Custom", yield_bps=100, use_worst_equity_window=True)
    preset = _apply_scenario(portfolio, "Stagflation")
    assert window["scenario"] == "Stagflation"
    assert window["growth_shock"] == preset["growth_shock"]
    assert window["portfolio_impact"] == preset["portfolio_impact"]


def test_custom_yield_scales_the_rate_path():
    rng = np.random.default_rng(4)
    n = 80
    yield_change = rng.normal(0, 0.03, n)
    spy = rng.normal(0, 0.01, n)
    series = 0.8 * yield_change
    result = _apply_scenario(
        _portfolio(series, "Equities", spy, yield_change),
        "Custom",
        yield_bps=100,
        equity_pct=0,
    )
    assert result["scenario"] == "Custom"
    assert result["yield_shock"] == 1.0
    assert result["growth_shock"] == 0.0
    assert abs(result["portfolio_impact"] / 100.0 - 0.8) < 0.005
    assert "100" in result["shock_label"]


def test_custom_cut_uses_duration_and_convexity():
    spy, yield_change = _market()
    result = _apply_scenario(
        _portfolio(np.zeros(len(spy)), "Bonds", spy, yield_change, duration=8),
        "Custom",
        yield_bps=-150,
        equity_pct=0,
    )
    priced = _duration_return(8, 0.04, -1.5)
    assert result["scenario"] == "Custom"
    assert "convexity" in result["shock_note"]
    assert abs(result["portfolio_impact"] / 100.0 - priced) < 0.005


def test_custom_equity_move_is_applied_with_the_yield_move():
    rng = np.random.default_rng(4)
    n = 80
    yield_change = rng.normal(0, 0.03, n)
    spy = rng.normal(0, 0.01, n)
    portfolio = _portfolio(spy, "Equities", spy, yield_change)
    rates_only = _apply_scenario(portfolio, "Custom", yield_bps=150, equity_pct=0)
    both = _apply_scenario(portfolio, "Custom", yield_bps=150, equity_pct=-20)
    assert both["scenario"] == "Custom"
    assert both["growth_shock"] == -0.2
    assert "S&P -20.0%" in both["shock_label"]
    assert both["portfolio_impact"] < rates_only["portfolio_impact"]


def test_custom_without_a_move_is_rejected():
    spy, yield_change = _market()
    with pytest.raises(LiveRiskError):
        _apply_scenario(_portfolio(spy, "Equities", spy, yield_change), "Custom")
