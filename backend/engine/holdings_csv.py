"""Read a holdings CSV.

The app's own file uses ticker, asset_class, quantity, and current_price.
A positions export from Schwab, Fidelity, LPL, BNY Mellon, or Raymond James
is accepted too. Account titles, totals, and disclaimer rows are skipped.
"""

import csv
import io
import re

from engine.equity_prices import uses_market_close_on_upload


class HoldingsCsvError(ValueError):
    pass


_APP_REQUIRED = {"ticker", "quantity"}

_SYMBOL_KEYS = ("ticker", "symbol", "securitysymbol", "symbolcusip", "securityid")
_QUANTITY_KEYS = (
    "quantity",
    "qty",
    "qtyquantity",
    "shares",
    "sharequantity",
    "units",
    "tradedatequantity",
    "settledquantity",
)
_PRICE_KEYS = (
    "price",
    "lastprice",
    "currentprice",
    "unitprice",
    "marketprice",
    "closingprice",
    "recentprice",
    "last",
    "shareprice",
    "priceest",
    "estimatedprice",
    "estprice",
)
_VALUE_KEYS = ("marketvalue", "mktval", "mktvalmarketvalue", "currentvalue", "positiondollarvalue")
_NAME_KEYS = ("description", "securitydescription", "securityname", "name", "assetname")
_CLASS_KEYS = (
    "securitytype",
    "assetclass",
    "assetcategory",
    "assettype",
    "assetclassification",
    "investmenttype",
)
_CUSIP_KEYS = ("cusip", "securitycusip")

_CASH_LABELS = {
    "cash",
    "cash & cash investments",
    "cash and cash investments",
    "cash & cash equivalents",
    "cash and cash equivalents",
}
_SKIP_LABELS = {"account total", "pending activity"}
_MISSING_NUMBERS = {"", "--", "n/a", "na", "incomplete", "null"}
_TICKER = re.compile(r"^[A-Z]{1,5}(?:[./-][A-Z]{1,2})?$")


def _class_word(word: str) -> bool:
    word = word.strip().lower().rstrip(",")
    return (
        word.startswith("equit")
        or word.startswith("stock")
        or word.startswith("bond")
        or word.startswith("fixed")
        or word.startswith("commod")
        or word.startswith("real")
        or word.startswith("cash")
    )


def _detach_class_word(name: str, asset_class: str) -> tuple[str, str]:
    """Pull a trailing Equity/Bond/Commodity word off the name when the class cell lost it."""
    if _class_word(asset_class.split(",")[0]):
        return name.strip(), asset_class.strip()
    words = name.split()
    if len(words) > 1 and _class_word(words[-1]):
        tail = words[-1] if not asset_class else f"{words[-1]}, {asset_class}"
        return " ".join(words[:-1]).strip(), tail.strip()
    return name.strip(), asset_class.strip()


def _table(contents: bytes) -> list[list[str]]:
    text = contents.decode("utf-8-sig").replace("\t", " ")
    return [
        [cell.strip() for cell in row]
        for row in csv.reader(io.StringIO(text))
        if any(cell.strip() for cell in row)
    ]


def _compact(cell: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", cell.lower())


def _header_index(header: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    for index, cell in enumerate(header):
        key = _compact(cell)
        if key and key not in found:
            found[key] = index
    return found


def _pick(found: dict[str, int], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        if key in found:
            return found[key]
    return None


def _is_broker_header(found: dict[str, int]) -> bool:
    return (
        _pick(found, _SYMBOL_KEYS) is not None
        and _pick(found, _QUANTITY_KEYS) is not None
        and (_pick(found, _PRICE_KEYS) is not None or _pick(found, _VALUE_KEYS) is not None)
    )


def _is_app_csv_header(found: dict[str, int]) -> bool:
    """Hustix app export: ticker + quantity, without broker name/type columns."""
    if "ticker" not in found or _pick(found, _QUANTITY_KEYS) is None:
        return False
    if "assetclass" in found:
        return True
    if _pick(found, _NAME_KEYS) is not None or _pick(found, _CLASS_KEYS) is not None:
        return False
    return _pick(found, _PRICE_KEYS) is not None or _pick(found, _VALUE_KEYS) is not None


def parse_holdings_csv(contents: bytes) -> list[dict[str, str]]:
    rows = _table(contents)
    if len(rows) < 2:
        raise HoldingsCsvError("CSV has no holdings.")

    header = _header_index(rows[0])
    if _is_app_csv_header(header):
        return _parse_app_rows(rows)

    parsed = _parse_broker_rows(rows)
    if parsed is not None:
        return parsed

    app_keys = _APP_REQUIRED & set(header)
    if len(app_keys) >= 2:
        missing = sorted(_display_name(key) for key in _APP_REQUIRED - set(header))
        raise HoldingsCsvError(f"CSV missing required columns: {', '.join(missing)}")

    raise HoldingsCsvError(
        "This CSV is not a holdings file. Upload a positions export from "
        "Schwab, Fidelity, LPL, BNY Mellon, or Raymond James, or a file with "
        "ticker, asset_class, quantity, and current_price (or market_value)."
    )


def _display_name(key: str) -> str:
    return {
        "assetclass": "asset_class",
        "currentprice": "current_price",
    }.get(key, key)


def _ensure_app_current_price(record: dict[str, str], line_no: int) -> None:
    if _number(record.get("current_price", "")) is not None:
        return
    quantity = _number(record.get("quantity", ""))
    market_value = _number(record.get("market_value", ""))
    if quantity not in {None, 0} and market_value is not None:
        record["current_price"] = _plain(market_value / quantity)
        return
    label = record.get("ticker") or record.get("asset_name") or f"row {line_no}"
    ticker = str(record.get("ticker") or label)
    if uses_market_close_on_upload(ticker, str(record.get("asset_class", ""))):
        record["current_price"] = "0"
        return
    raise HoldingsCsvError(
        f"Row {line_no}: {label} needs current_price, or market_value with quantity, for cash holdings."
    )


def _parse_app_rows(rows: list[list[str]]) -> list[dict[str, str]]:
    header = [cell.lower() for cell in rows[0]]
    while header and header[-1] == "":
        header.pop()
    if "asset_class" not in header:
        for index, cell in enumerate(header):
            if _compact(cell) == "assetclass":
                header[index] = "asset_class"
                break
    if "quantity" not in header:
        for index, cell in enumerate(header):
            if _compact(cell) in _QUANTITY_KEYS:
                header[index] = "quantity"
                break
    if "current_price" not in header:
        for index, cell in enumerate(header):
            if _compact(cell) in _PRICE_KEYS:
                header[index] = "current_price"
                break
    if "market_value" not in header:
        for index, cell in enumerate(header):
            if _compact(cell) in _VALUE_KEYS:
                header[index] = "market_value"
                break
    required = {"ticker", "quantity"}
    missing = required - set(header)
    if missing:
        raise HoldingsCsvError(f"CSV missing required columns: {', '.join(sorted(missing))}")
    width = len(header)
    parsed: list[dict[str, str]] = []
    for line_no, raw in enumerate(rows[1:], start=2):
        cells = list(raw)
        while cells and cells[-1] == "":
            cells.pop()
        if not any(cells):
            continue
        if len(cells) < width:
            raise HoldingsCsvError(f"Row {line_no} is missing columns.")
        if len(cells) > width:
            cells = cells[: width - 1] + [", ".join(cell for cell in cells[width - 1 :] if cell)]
        record = dict(zip(header, cells))
        if "asset_name" in record and "asset_class" in record:
            record["asset_name"], record["asset_class"] = _detach_class_word(
                record["asset_name"],
                record["asset_class"],
            )
        _ensure_app_current_price(record, line_no)
        parsed.append(record)
    if not parsed:
        raise HoldingsCsvError("CSV has no holdings.")
    return parsed


def _parse_broker_rows(rows: list[list[str]]) -> list[dict[str, str]] | None:
    columns: dict[str, int | None] | None = None
    parsed: list[dict[str, str]] = []
    for line_no, raw in enumerate(rows, start=1):
        found = _header_index(raw)
        if _is_broker_header(found):
            columns = {
                "symbol": _pick(found, _SYMBOL_KEYS),
                "quantity": _pick(found, _QUANTITY_KEYS),
                "price": _pick(found, _PRICE_KEYS),
                "value": _pick(found, _VALUE_KEYS),
                "name": _pick(found, _NAME_KEYS),
                "asset_class": _pick(found, _CLASS_KEYS),
                "cusip": _pick(found, _CUSIP_KEYS),
            }
            continue
        if columns is None:
            continue
        record = _broker_record(raw, columns, line_no)
        if record is not None:
            parsed.append(record)
    if columns is None:
        return None
    if not parsed:
        raise HoldingsCsvError("CSV has no holdings.")
    return parsed


def _cell(row: list[str], index: int | None) -> str:
    if index is None or index >= len(row):
        return ""
    return row[index].strip()


def _number(value: str) -> float | None:
    text = value.strip()
    if text.lower() in _MISSING_NUMBERS:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()").replace("$", "").replace(",", "").replace("+", "").strip()
    if not text or "%" in text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return -number if negative else number


def _plain(value: float) -> str:
    return format(value, "f").rstrip("0").rstrip(".") or "0"


def _looks_like_ticker(symbol: str) -> bool:
    return bool(_TICKER.match(symbol.upper()))


def _class_label(raw: str, symbol: str, name: str, cash_row: bool) -> str:
    if cash_row or "money market" in name.lower():
        return "Cash"
    text = raw.lower()
    if "money market" in text or ("cash" in text and "equity" not in text):
        return "Cash"
    if any(word in text for word in ("bond", "fixed", "treasury", "municipal")):
        return "Bond"
    if "commod" in text or text.strip() == "gold":
        return "Commodity"
    if "option" in text:
        return "Option"
    if any(word in text for word in ("equity", "stock", "etf", "mutual fund", "exchange traded")):
        return "Equity"
    lowered = name.lower()
    if _looks_like_ticker(symbol):
        return "Equity"
    if any(word in lowered for word in ("treasury", "bond", "municipal", "note due")):
        return "Bond"
    return raw.strip() or "Other"


def _broker_record(row: list[str], columns: dict[str, int | None], line_no: int) -> dict[str, str] | None:
    raw_symbol = _cell(row, columns["symbol"])
    name = _cell(row, columns["name"])
    if name in {"--", ""}:
        name = ""
    label = raw_symbol.lower()
    described = name.lower()
    if label in _SKIP_LABELS or described in _SKIP_LABELS or label.startswith("positions for"):
        return None

    cash_row = label in _CASH_LABELS or described in _CASH_LABELS
    marked_money_market = raw_symbol.endswith("*")
    symbol = "CASH" if cash_row else raw_symbol.rstrip("*").strip()
    if re.fullmatch(r"[A-Za-z]{1,5}/[A-Za-z]{1,2}", symbol):
        symbol = symbol.replace("/", "-")
    if not symbol:
        cusip = _cell(row, columns["cusip"])
        symbol = cusip if not cash_row else "CASH"
    if not symbol and not cash_row:
        return None

    quantity = _number(_cell(row, columns["quantity"]))
    price = _number(_cell(row, columns["price"]))
    market_value = _number(_cell(row, columns["value"]))
    asset_class = _class_label(_cell(row, columns["asset_class"]), symbol, name, cash_row or marked_money_market)

    if asset_class == "Cash" and market_value is not None and (quantity is None or price in {None, 0}):
        quantity = market_value
        price = 1.0
    elif price is None and quantity not in {None, 0} and market_value is not None:
        price = market_value / quantity

    if quantity is None and price is None and market_value is None:
        return None
    if quantity is None:
        raise HoldingsCsvError(f"Row {line_no}: {symbol or name} is missing a share quantity.")
    if price is None:
        raise HoldingsCsvError(f"Row {line_no}: {symbol or name} is missing a price.")
    if quantity == 0 and (market_value is None or market_value == 0):
        return None

    return {
        "ticker": symbol,
        "asset_name": name or symbol,
        "asset_class": asset_class,
        "quantity": _plain(quantity),
        "current_price": _plain(price),
    }


def number_field(value: str, column: str, ticker: str) -> float:
    number = _number(str(value))
    if number is None:
        label = ticker or "row"
        raise HoldingsCsvError(f"{column} for {label} must be a number, not {value!r}.")
    return number
