"""Which market-data vendor the process uses.

Set MARKET_DATA_PROVIDER in backend/.env to yahoo, eodhd, or tiingo.
The value is read on each call. The API process does not reload .env by itself.
"""

import os

from dotenv import load_dotenv

load_dotenv()

_YAHOO = "yahoo"
_EODHD = "eodhd"
_TIINGO = "tiingo"
_LABELS = {_YAHOO: "Yahoo Finance", _EODHD: "EODHD", _TIINGO: "Tiingo"}


def selected_provider() -> str:
    raw = (os.getenv("MARKET_DATA_PROVIDER") or _YAHOO).strip().lower()
    if raw in {_YAHOO, "yfinance"}:
        return _YAHOO
    if raw in {_EODHD, "eod"}:
        return _EODHD
    if raw == _TIINGO:
        return _TIINGO
    raise ValueError("MARKET_DATA_PROVIDER must be yahoo, eodhd, or tiingo.")


def provider_label() -> str:
    return _LABELS[selected_provider()]
