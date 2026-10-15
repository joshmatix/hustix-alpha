export function portfolioLimitSentence(
  name: string,
  portfolioLimit: number | null,
  tickerLimit: number | null,
) {
  if (portfolioLimit == null && tickerLimit == null) {
    return `${name} accounts are not limited by portfolio count.`;
  }
  if (portfolioLimit != null && tickerLimit != null) {
    return `${name} accounts can hold ${portfolioLimit} portfolios, with ${tickerLimit} tickers in each.`;
  }
  if (portfolioLimit != null) {
    return `${name} accounts can hold ${portfolioLimit} portfolios.`;
  }
  return `${name} accounts can hold ${tickerLimit} tickers in each portfolio.`;
}

export function signupPlanDetail(
  monthlyCents: number,
  portfolioLimit: number | null,
  tickerLimit: number | null,
) {
  if (monthlyCents === 0) {
    if (portfolioLimit != null && tickerLimit != null) {
      return `${portfolioLimit} portfolios, ${tickerLimit} tickers in each. No monthly charge.`;
    }
    return 'Open an account with no monthly charge.';
  }
  if (portfolioLimit != null && tickerLimit != null) {
    return `${portfolioLimit} portfolios, ${tickerLimit} tickers in each. Per month, for the advisor seat.`;
  }
  if (portfolioLimit != null) {
    return `Up to ${portfolioLimit} portfolios. Per month, for the advisor seat.`;
  }
  return 'No portfolio limit. Per month, for the advisor seat.';
}
