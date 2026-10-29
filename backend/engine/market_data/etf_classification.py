"""Map Tiingo fund metadata to institutional asset_class labels."""

from __future__ import annotations

from engine.equity_prices import is_cash_ticker_or_class, yahoo_symbol

_TICKER_OVERRIDES: dict[str, str] = {
    "TLT": "Bond, U.S., Long-Term Treasury",
    "IEF": "Bond, U.S., Intermediate Treasury",
    "IEI": "Bond, U.S., Short-Term Treasury",
    "SHY": "Bond, U.S., Short-Term Treasury",
    "AGG": "Bond, U.S., Aggregate",
    "BND": "Bond, U.S., Aggregate",
    "VTI": "Equity, U.S., Broad Market",
    "SPY": "Equity, U.S., Large Cap",
    "VXUS": "Equity, International, Developed",
    "EFA": "Equity, International, Developed",
    "GLD": "Gold",
    "DBC": "Commodity, Broad",
    "VNQ": "Real Assets, REIT",
}


def _text_blob(asset_type: str, name: str, description: str) -> str:
    return " ".join(
        part.strip().lower()
        for part in (asset_type, name, description)
        if part and str(part).strip()
    )


def classify_institutional_asset_class(
    asset_type: str,
    name: str,
    description: str,
    ticker: str,
) -> str | None:
    symbol = yahoo_symbol(ticker)
    if is_cash_ticker_or_class(symbol, ""):
        return "Cash"
    if symbol.endswith("-USD"):
        return "Equity, Crypto"

    override = _TICKER_OVERRIDES.get(symbol)
    if override:
        return override

    blob = _text_blob(asset_type, name, description)
    if not blob:
        return None

    type_key = asset_type.strip().lower()

    if "money market" in blob or blob == "cash":
        return "Cash"

    if type_key == "stock" or blob.startswith("stock "):
        return "Equity, U.S., Single Stock"

    if "20+ year" in blob or "20 year treasury" in blob or "long-term treasury" in blob:
        return "Bond, U.S., Long-Term Treasury"
    if "7-10 year" in blob or "3-7 year" in blob or "intermediate treasury" in blob:
        return "Bond, U.S., Intermediate Treasury"
    if "short-term treasury" in blob or "1-3 year" in blob:
        return "Bond, U.S., Short-Term Treasury"
    if "treasury" in blob or "fixed income" in blob or " aggregate bond" in blob or blob.startswith("bond"):
        if "aggregate" in blob or "total bond" in blob:
            return "Bond, U.S., Aggregate"
        return "Bond, U.S., Treasury"

    if "gold trust" in blob or " spdr gold" in blob or blob.startswith("gold"):
        return "Gold"
    if "commodity" in blob or "db commodity" in blob:
        return "Commodity, Broad"
    if "reit" in blob or "real estate" in blob:
        return "Real Assets, REIT"

    if "total stock" in blob or "broad market" in blob or "s&p 500" in blob or "large cap" in blob:
        return "Equity, U.S., Broad Market"
    if "international" in blob or "ex-us" in blob or "developed markets" in blob:
        return "Equity, International, Developed"

    if type_key in {"etf", "mutual fund"}:
        return "Equity, ETF"

    if type_key == "stock":
        return "Equity, U.S., Single Stock"

    return None
