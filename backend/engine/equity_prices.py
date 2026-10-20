"""Equity price lookups.

MARKET_DATA_PROVIDER in backend/.env chooses Yahoo or EODHD.
Single-ticker adds use the latest trade. CSV upload uses the last completed close.
"""

from engine.market_data import (
    canonical_symbol,
    fetch_closing_price,
    fetch_closing_prices,
    fetch_equity_price,
    fetch_equity_prices,
)

EQUITY_CLASSES = {"equities", "equity", "stocks", "stock"}


def is_equity_class(asset_class: str) -> bool:
    key = str(asset_class).strip().lower()
    if key in EQUITY_CLASSES:
        return True
    head = key.split(",")[0].strip()
    return head in EQUITY_CLASSES or head.startswith("equit") or head.startswith("stock")


def yahoo_symbol(ticker: str) -> str:
    """Stored ticker form. Dots become dashes, as in BRK.B -> BRK-B."""
    return canonical_symbol(ticker)


__all__ = [
    "fetch_closing_price",
    "fetch_closing_prices",
    "fetch_equity_price",
    "fetch_equity_prices",
    "is_equity_class",
    "yahoo_symbol",
]
