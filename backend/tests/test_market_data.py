"""Provider selection and price parsing. No live network calls."""

import json
from datetime import date, datetime

import pytest

from engine.market_data import eodhd, fetch_asset_classes, fetch_equity_price, provider_label, selected_provider
from engine.market_data import tiingo
from engine.market_data.etf_classification import classify_institutional_asset_class
from engine.market_data.symbols import canonical_symbol, eodhd_symbol, tiingo_symbol
from engine.market_data.yahoo import last_completed_close


def test_provider_setting(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "EODHD")
    assert selected_provider() == "eodhd"
    assert provider_label() == "EODHD"

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")
    assert selected_provider() == "yahoo"
    assert provider_label() == "Yahoo Finance"

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "tiingo")
    assert selected_provider() == "tiingo"
    assert provider_label() == "Tiingo"

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "other")
    with pytest.raises(ValueError):
        selected_provider()


def test_eodhd_symbols():
    assert canonical_symbol("brk.b") == "BRK-B"
    assert eodhd_symbol("AAPL") == "AAPL.US"
    assert eodhd_symbol("BRK.B") == "BRK-B.US"
    assert eodhd_symbol("^TNX") == "TNX.INDX"
    assert eodhd_symbol("DX-Y.NYB") == "DXY.INDX"
    assert eodhd_symbol("BTC-USD") == "BTC-USD.CC"
    assert eodhd_symbol("AAPL.US") == "AAPL.US"


def test_tiingo_symbols():
    assert tiingo_symbol("AAPL") == "aapl"
    assert tiingo_symbol("BRK.B") == "brk-b"
    assert tiingo_symbol("^TNX") == "tnx"
    assert tiingo_symbol("DX-Y.NYB") == "dxy"
    assert tiingo_symbol("BTC-USD") == "btcusd"


def test_dispatch_follows_the_setting(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "eodhd")
    monkeypatch.setattr("engine.market_data.eodhd.fetch_equity_price", lambda ticker: 1.5)
    assert fetch_equity_price("AAPL") == 1.5

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")
    monkeypatch.setattr("engine.market_data.yahoo.fetch_equity_price", lambda ticker: 2.5)
    assert fetch_equity_price("AAPL") == 2.5

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "tiingo")
    monkeypatch.setattr("engine.market_data.tiingo.fetch_equity_price", lambda ticker: 3.5)
    assert fetch_equity_price("AAPL") == 3.5


def _response(payload):
    class Response:
        status_code = 200

        def json(self):
            return payload

    return Response()


def test_eodhd_history_prefers_adjusted_close(monkeypatch):
    monkeypatch.setenv("EODHD_API_KEY", "test-token")

    def fake_get(url, params, timeout):
        assert "eod/AAPL.US" in url
        assert params["api_token"] == "test-token"
        return _response([
            {"date": "2026-10-02", "close": 11, "adjusted_close": 10.5},
            {"date": "2026-10-01", "close": 10, "adjusted_close": 9},
        ])

    monkeypatch.setattr(eodhd.requests, "get", fake_get)
    assert eodhd.fetch_daily_closes("AAPL") == {"2026-10-01": 9.0, "2026-10-02": 10.5}


def test_eodhd_close_skips_the_current_session(monkeypatch):
    monkeypatch.setenv("EODHD_API_KEY", "test-token")

    class FrozenDate(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 20)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 20, 15, tzinfo=tz)

    monkeypatch.setattr(eodhd, "date", FrozenDate)
    monkeypatch.setattr(eodhd, "datetime", FrozenDateTime)
    monkeypatch.setattr(
        eodhd.requests,
        "get",
        lambda url, params, timeout: _response([
            {"date": "2026-10-19", "close": 40, "adjusted_close": 40},
            {"date": "2026-10-20", "close": 41, "adjusted_close": 41},
        ]),
    )
    assert eodhd.fetch_closing_price("SPY") == 40


def test_eodhd_latest_trade_falls_back_when_the_quote_is_empty(monkeypatch):
    monkeypatch.setenv("EODHD_API_KEY", "test-token")

    def fake_get(url, params, timeout):
        if "real-time/" in url:
            return _response({"close": "NA"})
        return _response([{"date": "2026-10-19", "close": 99, "adjusted_close": 99}])

    monkeypatch.setattr(eodhd.requests, "get", fake_get)
    assert eodhd.fetch_equity_price("DXY") == 99


def test_missing_eodhd_key_is_an_error(monkeypatch):
    monkeypatch.delenv("EODHD_API_KEY", raising=False)
    with pytest.raises(ValueError):
        eodhd.fetch_daily_closes("AAPL")


def test_tiingo_history_prefers_adjusted_close(monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", "test-token")

    def fake_get(url, params, headers, timeout):
        assert url.endswith("/tiingo/daily/aapl/prices")
        assert headers["Authorization"] == "Token test-token"
        assert params["startDate"]
        return _response([
            {"date": "2026-10-01T00:00:00.000Z", "close": 10, "adjClose": 9},
            {"date": "2026-10-02T00:00:00.000Z", "close": 11, "adjClose": 10.5},
        ])

    monkeypatch.setattr(tiingo.requests, "get", fake_get)
    assert tiingo.fetch_daily_closes("AAPL") == {"2026-10-01": 9.0, "2026-10-02": 10.5}


def test_tiingo_close_skips_the_current_session(monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", "test-token")

    class FrozenDate(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 20)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 20, 15, tzinfo=tz)

    monkeypatch.setattr(tiingo, "date", FrozenDate)
    monkeypatch.setattr(tiingo, "datetime", FrozenDateTime)
    monkeypatch.setattr(
        tiingo.requests,
        "get",
        lambda url, params, headers, timeout: _response([
            {"date": "2026-10-19T00:00:00.000Z", "close": 40, "adjClose": 40},
            {"date": "2026-10-20T00:00:00.000Z", "close": 41, "adjClose": 41},
        ]),
    )
    assert tiingo.fetch_closing_price("SPY") == 40


def test_tiingo_latest_trade_falls_back_when_the_quote_is_empty(monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", "test-token")

    def fake_get(url, params, headers, timeout):
        if "/iex/" in url:
            return _response([{"tngoLast": None, "last": None}])
        return _response([{"date": "2026-10-19T00:00:00.000Z", "close": 99, "adjClose": 99}])

    monkeypatch.setattr(tiingo.requests, "get", fake_get)
    assert tiingo.fetch_equity_price("AAPL") == 99


def test_tiingo_yield_index_uses_fred_scaled_by_ten(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "fred-token")

    def fake_get(url, params, timeout):
        assert params["series_id"] == "DGS10"
        assert params["api_key"] == "fred-token"
        return _response({"observations": [
            {"date": "2026-10-17", "value": "4.10"},
            {"date": "2026-10-18", "value": "."},
            {"date": "2026-10-19", "value": "4.25"},
        ]})

    monkeypatch.setattr(tiingo.requests, "get", fake_get)
    assert tiingo.fetch_daily_closes("^TNX") == {"2026-10-17": 41.0, "2026-10-19": 42.5}


def _uup_history():
    def fake_get(url, params, headers, timeout):
        assert url.endswith("/tiingo/daily/uup/prices")
        return _response([
            {"date": "2026-10-17T00:00:00.000Z", "adjClose": 28.0},
            {"date": "2026-10-18T00:00:00.000Z", "adjClose": 28.4},
        ])

    return fake_get


def test_dollar_multiplier_updates_from_the_yahoo_close(monkeypatch, tmp_path):
    monkeypatch.setenv("TIINGO_API_KEY", "test-token")
    monkeypatch.setattr(tiingo, "_MULTIPLIER_PATH", tmp_path / "dxy_multiplier.json")
    monkeypatch.setattr(tiingo, "_refresh_attempt", {})
    monkeypatch.setattr(tiingo.requests, "get", _uup_history())
    calls = {"yahoo": 0}

    def closes():
        calls["yahoo"] += 1
        return {"2026-10-17": 28.0 * 3.53, "2026-10-18": 28.4 * 3.51}

    monkeypatch.setattr("engine.market_data.yahoo.fetch_dollar_closes", closes)
    level, change = tiingo.fetch_dollar_index()
    assert level == pytest.approx(28.4 * 3.51)
    assert change == pytest.approx((28.4 - 28.0) / 28.0 * 100)
    saved = json.loads((tmp_path / "dxy_multiplier.json").read_text())
    assert saved["as_of"] == "2026-10-18"
    assert saved["multiplier"] == pytest.approx(3.51)

    tiingo.fetch_dollar_index()
    assert calls["yahoo"] == 1


def test_dollar_multiplier_keeps_the_saved_ratio_when_yahoo_is_empty(monkeypatch, tmp_path):
    monkeypatch.setenv("TIINGO_API_KEY", "test-token")
    path = tmp_path / "dxy_multiplier.json"
    path.write_text(json.dumps({"as_of": "2026-10-17", "multiplier": 3.52}))
    monkeypatch.setattr(tiingo, "_MULTIPLIER_PATH", path)
    monkeypatch.setattr(tiingo, "_refresh_attempt", {})
    monkeypatch.setattr(tiingo.requests, "get", _uup_history())
    monkeypatch.setattr("engine.market_data.yahoo.fetch_dollar_closes", lambda: {})
    level, _change = tiingo.fetch_dollar_index()
    assert level == pytest.approx(28.4 * 3.52)
    assert json.loads(path.read_text())["as_of"] == "2026-10-17"


def test_institutional_asset_class_overrides_and_rules():
    assert classify_institutional_asset_class("ETF", "", "", "TLT") == "Bond, U.S., Long-Term Treasury"
    assert classify_institutional_asset_class("ETF", "iShares 20+ Year Treasury Bond ETF", "", "XYZ") == (
        "Bond, U.S., Long-Term Treasury"
    )
    assert classify_institutional_asset_class("Stock", "Apple Inc", "", "AAPL") == "Equity, U.S., Single Stock"


def test_fetch_asset_classes_tiingo_only(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")
    with pytest.raises(ValueError):
        fetch_asset_classes(["TLT"])

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "tiingo")
    monkeypatch.setattr(
        "engine.market_data.tiingo.fetch_asset_classes",
        lambda tickers: {"TLT": "Bond, U.S., Long-Term Treasury"},
    )
    assert fetch_asset_classes(["TLT"]) == {"TLT": "Bond, U.S., Long-Term Treasury"}


def test_missing_tiingo_key_is_an_error(monkeypatch):
    monkeypatch.delenv("TIINGO_API_KEY", raising=False)
    with pytest.raises(ValueError):
        tiingo.fetch_daily_closes("AAPL")


def test_yahoo_close_skips_today_while_the_session_is_open():
    start = 1_700_000_000
    day = 86_400
    block = {
        "meta": {
            "marketState": "REGULAR",
            "currentTradingPeriod": {"regular": {"start": start + 2 * day}},
        },
        "timestamp": [start, start + day, start + 2 * day],
        "indicators": {"quote": [{"close": [10, 11, 12]}]},
    }
    assert last_completed_close(block) == 11
