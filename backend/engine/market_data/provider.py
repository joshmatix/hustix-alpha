"""Which market-data vendor the process uses.

Set MARKET_DATA_PROVIDER in backend/.env to yahoo or eodhd.
The value is read on each call. The API process does not reload .env by itself.
"""

import os

from dotenv import load_dotenv

load_dotenv()

_YAHOO = "yahoo"
_EODHD = "eodhd"


def selected_provider() -> str:
    raw = (os.getenv("MARKET_DATA_PROVIDER") or _YAHOO).strip().lower()
    if raw in {_YAHOO, "yfinance"}:
        return _YAHOO
    if raw in {_EODHD, "eod"}:
        return _EODHD
    raise ValueError("MARKET_DATA_PROVIDER must be yahoo or eodhd.")


def provider_label() -> str:
    return "EODHD" if selected_provider() == _EODHD else "Yahoo Finance"
