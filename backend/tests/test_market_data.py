"""Provider selection and price parsing. No live network calls."""

from datetime import date, datetime

import pytest

from engine.market_data import eodhd, fetch_equity_price, provider_label, selected_provider
from engine.market_data.symbols import canonical_symbol, eodhd_symbol
from engine.market_data.yahoo import last_completed_close


def test_provider_setting(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "EODHD")
    assert selected_provider() == "eodhd"
    assert provider_label() == "EODHD"

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")
    assert selected_provider() == "yahoo"
    assert provider_label() == "Yahoo Finance"

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


def test_dispatch_follows_the_setting(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "eodhd")
    monkeypatch.setattr("engine.market_data.eodhd.fetch_equity_price", lambda ticker: 1.5)
    assert fetch_equity_price("AAPL") == 1.5

    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")
    monkeypatch.setattr("engine.market_data.yahoo.fetch_equity_price", lambda ticker: 2.5)
    assert fetch_equity_price("AAPL") == 2.5


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
