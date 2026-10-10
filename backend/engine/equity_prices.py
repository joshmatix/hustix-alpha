"""Latest equity prices from Yahoo Finance."""

from concurrent.futures import ThreadPoolExecutor

import requests

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
EQUITY_CLASSES = {"equities", "equity", "stocks", "stock"}
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def is_equity_class(asset_class: str) -> bool:
    return str(asset_class).strip().lower() in EQUITY_CLASSES


def yahoo_symbol(ticker: str) -> str:
    return str(ticker).strip().upper().replace(".", "-")


def fetch_equity_price(ticker: str) -> float | None:
    symbol = yahoo_symbol(ticker)
    if not symbol:
        return None
    response = requests.get(
        YAHOO_CHART_URL.format(symbol=symbol),
        params={"interval": "1d", "range": "1d"},
        headers=_HEADERS,
        timeout=10,
    )
    if response.status_code != 200:
        return None
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return None
    price = (result[0].get("meta") or {}).get("regularMarketPrice")
    if price is None:
        return None
    price = float(price)
    if price <= 0:
        return None
    return price


def fetch_equity_prices(tickers: list[str]) -> dict[str, float]:
    unique: list[str] = []
    seen: set[str] = set()
    for ticker in tickers:
        symbol = yahoo_symbol(ticker)
        if symbol and symbol not in seen:
            seen.add(symbol)
            unique.append(symbol)
    if not unique:
        return {}

    prices: dict[str, float] = {}
    workers = min(8, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, price in zip(unique, pool.map(fetch_equity_price, unique)):
            if price is not None:
                prices[symbol] = price
    return prices
