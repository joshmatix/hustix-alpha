"""Yahoo chart prices. Unofficial chart endpoint, no API key."""

from datetime import datetime, timezone
from urllib.parse import quote

import requests

from engine.market_data.symbols import canonical_symbol

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HISTORY_RANGE = "2y"
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def _chart(symbol: str, params: dict) -> dict | None:
    safe = quote(canonical_symbol(symbol), safe="")
    response = requests.get(
        CHART_URL.format(symbol=safe),
        params=params,
        headers=_HEADERS,
        timeout=15,
    )
    if response.status_code != 200:
        return None
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return None
    return result[0]


def _positive_price(value: object) -> float | None:
    if value is None:
        return None
    price = float(value)
    if price <= 0:
        return None
    return price


def last_completed_close(block: dict) -> float | None:
    """Official daily close. Skip today's bar while the regular session is open."""
    meta = block.get("meta") or {}
    timestamps = block.get("timestamp") or []
    closes = ((block.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    pairs: list[tuple[int, float]] = []
    for stamp, price in zip(timestamps, closes):
        parsed = _positive_price(price)
        if parsed is None:
            continue
        pairs.append((int(stamp), parsed))

    state = str(meta.get("marketState") or "").upper()
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start = regular.get("start")
    if state == "REGULAR" and pairs and start is not None:
        session_day = datetime.fromtimestamp(int(start), tz=timezone.utc).date()
        completed = [
            price
            for stamp, price in pairs
            if datetime.fromtimestamp(stamp, tz=timezone.utc).date() < session_day
        ]
        if completed:
            return completed[-1]
        if len(pairs) >= 2:
            return pairs[-2][1]
        return _positive_price(meta.get("chartPreviousClose") or meta.get("previousClose"))

    if pairs:
        return pairs[-1][1]
    return _positive_price(meta.get("chartPreviousClose") or meta.get("previousClose"))


def fetch_equity_price(ticker: str) -> float | None:
    block = _chart(ticker, {"interval": "1d", "range": "1d"})
    if block is None:
        return None
    return _positive_price((block.get("meta") or {}).get("regularMarketPrice"))


def fetch_closing_price(ticker: str) -> float | None:
    block = _chart(ticker, {"interval": "1d", "range": "10d"})
    if block is None:
        return None
    return last_completed_close(block)


def fetch_daily_closes(symbol: str) -> dict[str, float]:
    block = _chart(symbol, {"interval": "1d", "range": HISTORY_RANGE})
    if block is None:
        return {}
    timestamps = block.get("timestamp") or []
    indicators = block.get("indicators") or {}
    adjusted = (indicators.get("adjclose") or [{}])[0].get("adjclose")
    closes = (indicators.get("quote") or [{}])[0].get("close") or []
    series = adjusted if isinstance(adjusted, list) and any(value is not None for value in adjusted) else closes
    prices: dict[str, float] = {}
    for stamp, price in zip(timestamps, series):
        parsed = _positive_price(price)
        if parsed is None:
            continue
        day = datetime.fromtimestamp(int(stamp), tz=timezone.utc).date().isoformat()
        prices[day] = parsed
    return prices


def fetch_dollar_closes() -> dict[str, float]:
    """Completed daily closes for the ICE dollar index, DX-Y.NYB."""
    response = requests.get(
        "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB",
        params={"interval": "1d", "range": "10d"},
        headers=_HEADERS,
        timeout=10,
    )
    if response.status_code != 200:
        return {}
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return {}
    block = result[0]
    meta = block.get("meta") or {}
    timestamps = block.get("timestamp") or []
    closes = ((block.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    pairs: list[tuple[str, float]] = []
    for stamp, price in zip(timestamps, closes):
        parsed = _positive_price(price)
        if parsed is None:
            continue
        day = datetime.fromtimestamp(int(stamp), tz=timezone.utc).date().isoformat()
        pairs.append((day, parsed))
    state = str(meta.get("marketState") or "").upper()
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start = regular.get("start")
    if state == "REGULAR" and pairs and start is not None:
        session_day = datetime.fromtimestamp(int(start), tz=timezone.utc).date().isoformat()
        completed = [(day, price) for day, price in pairs if day < session_day]
        if completed:
            pairs = completed
    return dict(pairs)


def fetch_dollar_index() -> tuple[float | None, float | None]:
    """ICE US Dollar Index and its percent move from the prior close."""
    response = requests.get(
        "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB",
        params={"interval": "1d", "range": "5d"},
        headers=_HEADERS,
        timeout=10,
    )
    if response.status_code != 200:
        return None, None
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return None, None
    meta = result[0].get("meta") or {}
    latest = _positive_price(meta.get("regularMarketPrice"))
    prior = _positive_price(meta.get("previousClose") or meta.get("chartPreviousClose"))
    if latest is None or prior is None:
        return None, None
    return latest, (latest - prior) / prior * 100
