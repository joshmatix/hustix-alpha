"""Price lookups. Callers keep using these functions. The vendor is selected underneath."""

from concurrent.futures import ThreadPoolExecutor

from engine.market_data.provider import provider_label, selected_provider
from engine.market_data.symbols import canonical_symbol

__all__ = [
    "canonical_symbol",
    "fetch_asset_classes",
    "fetch_closing_price",
    "fetch_closing_prices",
    "fetch_daily_closes",
    "fetch_dollar_index",
    "fetch_equity_price",
    "fetch_equity_prices",
    "provider_label",
    "selected_provider",
]


def _vendor():
    provider = selected_provider()
    if provider == "eodhd":
        from engine.market_data import eodhd as vendor
    elif provider == "tiingo":
        from engine.market_data import tiingo as vendor
    else:
        from engine.market_data import yahoo as vendor
    return vendor


def fetch_equity_price(ticker: str) -> float | None:
    return _vendor().fetch_equity_price(ticker)


def fetch_closing_price(ticker: str) -> float | None:
    return _vendor().fetch_closing_price(ticker)


def fetch_daily_closes(symbol: str) -> dict[str, float]:
    return _vendor().fetch_daily_closes(symbol)


def fetch_dollar_index() -> tuple[float | None, float | None]:
    return _vendor().fetch_dollar_index()


def _fetch_many(tickers: list[str], fetch) -> dict[str, float]:
    unique: list[str] = []
    seen: set[str] = set()
    for ticker in tickers:
        symbol = canonical_symbol(ticker)
        if symbol and symbol not in seen:
            seen.add(symbol)
            unique.append(symbol)
    if not unique:
        return {}

    prices: dict[str, float] = {}
    workers = min(8, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, price in zip(unique, pool.map(fetch, unique)):
            if price is not None:
                prices[symbol] = price
    return prices


def fetch_closing_prices(tickers: list[str]) -> dict[str, float]:
    return _fetch_many(tickers, fetch_closing_price)


def fetch_equity_prices(tickers: list[str]) -> dict[str, float]:
    return _fetch_many(tickers, fetch_equity_price)


def fetch_asset_classes(tickers: list[str]) -> dict[str, str]:
    if selected_provider() != "tiingo":
        raise ValueError("fetch_asset_classes requires MARKET_DATA_PROVIDER=tiingo")
    from engine.market_data import tiingo as vendor

    return vendor.fetch_asset_classes(tickers)
