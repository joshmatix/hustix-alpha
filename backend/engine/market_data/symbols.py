"""Ticker forms.

The app stores tickers in canonical form: upper case, with a dot turned into a dash
(BRK.B becomes BRK-B). EODHD wants an exchange suffix on top of that.
Tiingo wants the canonical symbol in lower case, with no exchange suffix.
"""

_EXCHANGES = {
    "AU",
    "BA",
    "CC",
    "FOREX",
    "INDX",
    "KO",
    "LSE",
    "MX",
    "NEO",
    "PA",
    "SA",
    "TO",
    "US",
    "V",
    "XETRA",
}

# Yahoo's dollar-index code. EODHD lists the same index as DXY.INDX.
_DOLLAR_INDEX = {"DX-Y.NYB", "DX-Y-NYB"}


def canonical_symbol(ticker: str) -> str:
    return str(ticker).strip().upper().replace(".", "-")


def eodhd_symbol(ticker: str) -> str:
    raw = str(ticker).strip().upper()
    if raw in _DOLLAR_INDEX:
        return "DXY.INDX"
    if "." in raw:
        suffix = raw.rsplit(".", 1)[1]
        if suffix in _EXCHANGES:
            return raw
    symbol = canonical_symbol(raw)
    if symbol in _DOLLAR_INDEX:
        return "DXY.INDX"
    if symbol.startswith("^"):
        return f"{symbol[1:]}.INDX"
    if symbol.endswith("-USD"):
        return f"{symbol}.CC"
    return f"{symbol}.US"


def tiingo_symbol(ticker: str) -> str:
    """Tiingo equity ticker. Class shares stay hyphenated, as in brk-b."""
    raw = str(ticker).strip().upper()
    if raw in _DOLLAR_INDEX:
        return "dxy"
    symbol = canonical_symbol(raw)
    if symbol in _DOLLAR_INDEX:
        return "dxy"
    if symbol.startswith("^"):
        symbol = symbol[1:]
    if symbol.endswith("-USD"):
        return symbol.replace("-", "").lower()
    return symbol.lower()
