# Monte Carlo compliance audit

A methodology-and-results attestation. The engine can document what was assumed, which data window was used, and which summary numbers came out. It cannot support a reproducibility ledger.

The advisor PDF already prints most of this. A compliance version would keep those sections and add an explicit scope statement.

## Run identity

Firm, advisor, portfolio name, report id, and generation time in UTC. Holdings as uploaded: ticker, asset class, quantity, price, and market value. Starting portfolio value.

## Live stress test

This is the historical run. The report can state the price vendor, the requested two-year lookback, and the exact start and end dates of the overlapping trading days actually used. It can state the fixed settings: 1,000 paths, 252 trading days, cash accrual as a daily rate from the fed-funds feed, and each scenario's yield shock and equity shock. It can describe the method in one place: the shock reprices the starting value once, then each path resamples demeaned historical daily returns. It can list the regression gate (R-squared of at least 5% on 60 or more days) and name every holding that used a class fallback. Results that can be attached are the mean shocked value, the 95% loss versus the starting value, the portfolio impact, and the impact by asset class.

## Parametric Monte Carlo

This is a separate engine and should be labeled as such. The report can name the distribution (Student's t, normal, or bootstrap), print the fixed parameters in code (`df`, `loc`, `scale`, and bootstrap source size), the path count requested (1,000 to 50,000), the horizon in years and trading days, and the yield-shock multiplier. Terminal results that can be attached are the 1st, 5th, 25th, 50th, 75th, and 95th percentiles, plus 95% and 99% loss and 95% expected shortfall. The client longevity cone can add the year-by-year 5th, 50th, and 95th values for 10 years and 4,000 Student's t paths.

## Required disclosures

The random draw is unseeded, so a later rerun will not match to the penny. Trial paths are discarded after the summaries are computed. No test is run to show that the path count was enough for the percentiles to settle. The parametric draws use one fixed daily distribution for the whole account. They are not estimated from this portfolio's means, volatilities, or covariances. There is no spending or withdrawal rate in either engine.
