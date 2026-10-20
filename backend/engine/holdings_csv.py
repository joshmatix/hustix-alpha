"""Read a holdings CSV without shifting columns when a class name contains commas."""

import csv
import io


class HoldingsCsvError(ValueError):
    pass


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


def parse_holdings_csv(contents: bytes) -> list[dict[str, str]]:
    text = contents.decode("utf-8-sig").replace("\t", " ")
    rows = [
        [cell.strip() for cell in row]
        for row in csv.reader(io.StringIO(text))
        if any(cell.strip() for cell in row)
    ]
    if len(rows) < 2:
        raise HoldingsCsvError("CSV has no holdings.")

    header = [cell.lower() for cell in rows[0]]
    while header and header[-1] == "":
        header.pop()
    required = {"ticker", "asset_class", "quantity", "current_price"}
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
        parsed.append(record)
    if not parsed:
        raise HoldingsCsvError("CSV has no holdings.")
    return parsed


def number_field(value: str, column: str, ticker: str) -> float:
    try:
        return float(str(value).replace(",", ""))
    except ValueError as exc:
        label = ticker or f"row"
        raise HoldingsCsvError(f"{column} for {label} must be a number, not {value!r}.") from exc
