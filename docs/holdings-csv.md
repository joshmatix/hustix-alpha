# Holdings CSV

Upload a `.csv` file from a portfolio card. The upload replaces every holding already in that portfolio. A sample file is at [`frontend/public/samples/holdings-sample.csv`](../frontend/public/samples/holdings-sample.csv), and the app serves it at `/samples/holdings-sample.csv`.

## File shape

- UTF-8 text, one holding per row, with a header row.
- Column names are not case-sensitive, and spaces around a name are ignored.
- Column order does not matter, except when a cell contains a comma. Put `asset_class` last, or wrap that cell in double quotes, so the comma stays inside the class.
- Do not use a thousands separator unless the cell is quoted. `114` is safe. `"1,140"` is safe. An unquoted `1,140` is read as two columns.
- A blank line is skipped. A row with fewer cells than the header is rejected.

## Columns

| Column | Required | Meaning |
| --- | --- | --- |
| `ticker` | yes | Exchange symbol. `BRK.B` is stored as `BRK-B`. |
| `asset_class` | yes | Slice of the portfolio mix. See the labels below. |
| `quantity` | yes | Number of shares or units, not a dollar amount. |
| `current_price` | yes | Price per share, in the portfolio currency. |
| `asset_name` | no | Display name. The ticker is used when this is blank. |
| `duration_years` | no | Bond duration used for rate shocks. Use `0` for everything else. |
| `beta` | no | Market beta used in the factor table. Defaults to `1` when omitted. |

Any other column, such as `currency`, is ignored.

Market value is `quantity × price`. For cash, set `current_price` to `1` and put the dollar amount in `quantity`.

## Prices

Equity rows must use a ticker Yahoo Finance can price. The file's `current_price` is still required, but the upload replaces it with the last completed session close.

Bond, commodity, gold, and cash rows keep the `current_price` from the file. Those tickers still need Yahoo price history before a risk run, except `CASH`, `USD`, and `USD-CASH`.

## Class labels

The first class word in `asset_class` chooses the slice. Matching ignores case.

| Words | Slice | Price used |
| --- | --- | --- |
| Equity, Equities, Stock, Stocks | Equities | Yahoo close |
| Bond, Bonds, Fixed Income | Fixed income | File price |
| Commodity, Commodities, Real Assets, Gold | Real assets | File price |
| Cash | Cash | File price (`1`) |
| Anything else | Equities | Yahoo close |

A longer label is fine when the class word comes first, for example `Bond, U.S., Long-Term`. Quote it:

```csv
ticker,quantity,current_price,asset_name,asset_class
TLT,5034,79.46,iShares 20+ Year Treasury,"Bond, U.S., Long-Term"
```

## Sample

`duration_years` and `beta` in the sample are illustrations, not live figures.

```csv
ticker,asset_name,quantity,current_price,duration_years,beta,asset_class
VTI,Vanguard Total Stock Market,799,375.54,0,1,Equity
TLT,iShares 20+ Year Treasury Bond,5034,79.46,16.5,0.3,Bond
IEI,iShares 3-7 Year Treasury Bond,1316,114,4.5,0.2,Bond
DBC,Invesco DB Commodity Tracking,2227,33.68,0,0.3,Commodity
GLD,SPDR Gold Trust,198,379.69,0,0.1,Gold
CASH,US Dollar,10000,1,0,0,Cash
```

That file is about 30% equities, 55% bonds, 15% real assets, and 1% cash, before the equity close replaces the VTI price in the file.
