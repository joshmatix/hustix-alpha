import pytest

from engine.equity_prices import is_equity_class
from engine.holdings_csv import HoldingsCsvError, parse_holdings_csv
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


SCHWAB = """Positions for account Individual as of 09:13 PM ET, 02/04/2023

Individual ...321
Symbol,Description,Quantity,Price,Price Change %,Price Change $,Market Value,Day Change %,Day Change $,Cost Basis,Gain/Loss %,Gain/Loss $,Ratings,Reinvest Dividends?,Capital Gains?,% Of Account,Security Type
AMD,ADVANCED MICRO DEVIC,0.133,$86.09,-2.51%,-$2.22,$11.45,-2.51%,-$0.30,$45.00,59.36%,$26.71,C,Yes,--,4.06%,Equity
SWVXX,SCHWAB VALUE ADVANTAGE MONEY FUND,"5,000",$1.00,--,--,"$5,000.00",--,--,--,--,--,--,Yes,--,50%,Money Market
"Cash & Cash Investments",--,--,--,--,--,$5.20,0%,$0.00,--,--,--,--,--,--,0.29%,"Cash and Money Market"
Account Total,--,--,--,--,--,$5016.65,--,--,--,--,--,--,--,--,--,--
""".encode()


FIDELITY = """Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Cost Basis Total,Type
Z12345678,Individual,AAPL,APPLE INC,100,$190.50,+$1.20,$19050.00,$15000.00,Cash
Z12345678,Individual,SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,6000.00,$1.00,$0.00,$6000.00,--,Cash
Z12345678,Individual,FXAIX,FIDELITY 500 INDEX FUND,80,$180.00,-$0.50,$14400.00,$12000.00,Cash
Z12345678,Individual,Pending Activity,,,,,$250.00,,
Z12345678,Individual,,Account Total,,,,$39700.00,,
"The data and information in this spreadsheet is provided to you solely for your use."
"Date downloaded 07/07/2026 9:12 PM ET"
""".encode()


LPL = """Client Name,Account Number,Security Name,Security Type,Ticker,CUSIP,Share Quantity,Price,Market Value
Jane Doe,111,Apple Inc,Equity,AAPL,037833100,10,190.50,1905.00
Jane Doe,111,US Treasury Note,Fixed Income,,912828C57,10000,98.50,9850.00
""".encode()


BNY = """Account Number,Security Symbol,Security CUSIP,Security Description,Trade Date Quantity,Market Price,Market Value,Asset Classification
88421,MSFT,594918104,MICROSOFT CORP,4,400.00,1600.00,Equity
88421,,912828C57,US TREASURY NOTE,5000,99.25,4962.50,Fixed Income
88421,,,CASH AND CASH EQUIVALENTS,,,250.00,Cash
""".encode()


RAYMOND_JAMES = """Symbol/CUSIP,Description,Quantity,Last,Market Value,Security Type
AAPL,APPLE INC,25,$190.25,"$4,756.25",Equity
BRK/B,BERKSHIRE HATHAWAY,2,$532.23,"$1,064.46",Equity
"Cash & Cash Investments",Cash,--,--,"$1,200.00",Cash
""".encode()


def test_schwab_positions_export_skips_titles_and_totals():
    rows = parse_holdings_csv(SCHWAB)
    assert [(row["ticker"], row["asset_class"], row["quantity"], row["current_price"]) for row in rows] == [
        ("AMD", "Equity", "0.133", "86.09"),
        ("SWVXX", "Cash", "5000", "1"),
        ("CASH", "Cash", "5.2", "1"),
    ]
    assert rows[0]["asset_name"] == "ADVANCED MICRO DEVIC"


def test_fidelity_type_column_is_not_the_asset_class():
    rows = parse_holdings_csv(FIDELITY)
    assert [(row["ticker"], row["asset_class"], row["quantity"], row["current_price"]) for row in rows] == [
        ("AAPL", "Equity", "100", "190.5"),
        ("SPAXX", "Cash", "6000", "1"),
        ("FXAIX", "Equity", "80", "180"),
    ]


def test_lpl_clientworks_export():
    rows = parse_holdings_csv(LPL)
    assert rows[0]["ticker"] == "AAPL"
    assert rows[0]["asset_name"] == "Apple Inc"
    assert rows[0]["asset_class"] == "Equity"
    assert rows[1]["ticker"] == "912828C57"
    assert rows[1]["asset_class"] == "Bond"
    assert rows[1]["current_price"] == "98.5"


def test_bny_mellon_positions_export():
    rows = parse_holdings_csv(BNY)
    assert [(row["ticker"], row["asset_class"], row["quantity"], row["current_price"]) for row in rows] == [
        ("MSFT", "Equity", "4", "400"),
        ("912828C57", "Bond", "5000", "99.25"),
        ("CASH", "Cash", "250", "1"),
    ]
    assert rows[2]["asset_name"] == "CASH AND CASH EQUIVALENTS"


def test_raymond_james_positions_export():
    rows = parse_holdings_csv(RAYMOND_JAMES)
    assert [(row["ticker"], row["asset_class"], row["quantity"], row["current_price"]) for row in rows] == [
        ("AAPL", "Equity", "25", "190.25"),
        ("BRK-B", "Equity", "2", "532.23"),
        ("CASH", "Cash", "1200", "1"),
    ]


def test_market_value_fills_a_missing_price():
    exported = """Symbol,Quantity,MarketValue,SecurityType
VTI,10,2800,ETF
""".encode()
    row = parse_holdings_csv(exported)[0]
    assert row["ticker"] == "VTI"
    assert row["asset_class"] == "Equity"
    assert row["quantity"] == "10"
    assert row["current_price"] == "280"


def test_unrecognized_csv_names_the_accepted_exports():
    with pytest.raises(HoldingsCsvError, match="Schwab, Fidelity, LPL, BNY Mellon, or Raymond James"):
        parse_holdings_csv(b"Foo,Bar\n1,2\n")


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
