from engine.equity_prices import is_equity_class
from engine.holdings_csv import parse_holdings_csv
from routers.portfolios import _allocation_bucket, allocation_from_holdings


SAMPLE = """quantity, ticker, current_price, currency, asset_name, asset_class
\t799, VTI, 375.54,\tUSD,\t\tVanguard Total Stock Market,\tEquity, U.S., Large Cap (USD)
\t5034, TLT, 79.46,\tUSD,\t\tiShares 20+ Year Treasury Bond,\tBond, U.S., Long-Term (USD)
\t1316, IEI, 114,\tUSD,\t\tiShares 3-7 Year Treasury Bond,\tBond, U.S., Intermediate-Term (USD)
\t2227, DBC, 33.68,\tUSD,\t\tInvesco DB Commodity Tracking,\tCommodity, Broad Diversified (USD)
\t198, GLD,  379.69,\tUSD,\t\tSPDR Gold Trust,\tCommodity, Gold (USD)
""".encode()


def test_commas_inside_asset_class_stay_with_the_class():
    rows = parse_holdings_csv(SAMPLE)
    first = rows[0]
    assert first["quantity"] == "799"
    assert first["ticker"] == "VTI"
    assert first["current_price"] == "375.54"
    assert first["asset_name"] == "Vanguard Total Stock Market"
    assert first["asset_class"] == "Equity, U.S., Large Cap (USD)"
    assert [(row["ticker"], row["asset_class"].split(",")[0]) for row in rows] == [
        ("VTI", "Equity"),
        ("TLT", "Bond"),
        ("IEI", "Bond"),
        ("DBC", "Commodity"),
        ("GLD", "Commodity"),
    ]


def test_tab_between_name_and_class_is_kept_on_the_class():
    pasted = """quantity, ticker, current_price, currency, asset_name, asset_class
\t799, VTI, 375.54,\tUSD,\t\tVanguard Total Stock Market\tEquity, U.S., Large Cap (USD)
""".encode()
    row = parse_holdings_csv(pasted)[0]
    assert row["quantity"] == "799"
    assert row["ticker"] == "VTI"
    assert row["asset_name"] == "Vanguard Total Stock Market"
    assert row["asset_class"] == "Equity, U.S., Large Cap (USD)"


def test_class_buckets_follow_the_label_before_the_comma():
    assert is_equity_class("Equity, U.S., Large Cap (USD)")
    assert not is_equity_class("Bond, U.S., Long-Term (USD)")
    assert _allocation_bucket("Equity, U.S., Large Cap (USD)") == "equities"
    assert _allocation_bucket("Bond, U.S., Long-Term (USD)") == "bonds"
    assert _allocation_bucket("Commodity, Gold (USD)") == "realAssets"
    assert _allocation_bucket("Bond") == "bonds"
    assert _allocation_bucket("Commodity") == "realAssets"
    assert _allocation_bucket("Gold") == "realAssets"


def test_singular_labels_split_the_pie():
    rows = [
        {"asset_class": "Equity", "quantity": 799, "current_price": 375.54},
        {"asset_class": "Bond", "quantity": 5034, "current_price": 79.46},
        {"asset_class": "Bond", "quantity": 1316, "current_price": 114},
        {"asset_class": "Commodity", "quantity": 2227, "current_price": 33.68},
        {"asset_class": "Gold", "quantity": 198, "current_price": 379.69},
    ]
    assert allocation_from_holdings(rows) == {
        "equities": 30.0,
        "bonds": 55.0,
        "realAssets": 15.0,
        "cash": 0.0,
    }
