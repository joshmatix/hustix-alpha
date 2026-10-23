import Link from 'next/link';

export const metadata = {
  title: 'Help',
  description: 'How to prepare a holdings CSV and upload it to a portfolio.',
};

const columns = [
  ['ticker', 'Yes', 'Exchange symbol. BRK.B is stored as BRK-B.'],
  ['asset_class', 'Yes', 'Slice of the portfolio mix. See the class labels below.'],
  ['quantity', 'Yes', 'Number of shares or units, not a dollar amount.'],
  ['current_price', 'Yes', 'Price per share, in the portfolio currency.'],
  ['asset_name', 'No', 'Display name. The ticker is used when this is blank.'],
  ['duration_years', 'No', 'Bond duration used for rate shocks. Use 0 for everything else.'],
  ['beta', 'No', 'Market beta used in the factor table. Defaults to 1 when omitted.'],
];

const classes = [
  ['Equity, Equities, Stock, Stocks', 'Equities', 'Market-data close'],
  ['Bond, Bonds, Fixed Income', 'Fixed income', 'File price'],
  ['Commodity, Commodities, Real Assets, Gold', 'Real assets', 'File price'],
  ['Cash', 'Cash', 'File price (1)'],
  ['Anything else', 'Equities', 'Market-data close'],
];

const sample = `ticker,asset_name,quantity,current_price,duration_years,beta,asset_class
VTI,Vanguard Total Stock Market,799,375.54,0,1,Equity
TLT,iShares 20+ Year Treasury Bond,5034,79.46,16.5,0.3,Bond
IEI,iShares 3-7 Year Treasury Bond,1316,114,4.5,0.2,Bond
DBC,Invesco DB Commodity Tracking,2227,33.68,0,0.3,Commodity
GLD,SPDR Gold Trust,198,379.69,0,0.1,Gold`;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Help</h1>
        <p className="mt-1 text-xs text-slate-400">
          Guides for the controls in the app. Start with the holdings file used on Portfolios.
        </p>
      </div>

      <nav aria-label="On this page" className="text-sm">
        <Link href="#holdings-csv" className="font-medium text-indigo-300 hover:text-indigo-200">
          Holdings CSV
        </Link>
      </nav>

      <Section id="holdings-csv" title="Holdings CSV">
        <p>
          On Portfolios, open a portfolio card and choose Upload CSV. The file replaces every
          holding already in that portfolio.
        </p>
        <p>
          A positions export from Charles Schwab, Fidelity, LPL ClientWorks, BNY Mellon, or
          Raymond James can be uploaded as downloaded. Account titles, totals, and disclaimer
          rows are skipped. Cash and money-market rows are stored as cash.
        </p>
        <p>
          <a
            href="/samples/holdings-sample.csv"
            download="holdings-sample.csv"
            className="font-semibold text-indigo-300 hover:text-indigo-200"
          >
            Download the sample CSV
          </a>
          . The duration and beta values in that file are illustrations, not live figures. The
          sample has five holdings, which fits the Free plan. Before the equity close replaces
          the VTI price, it is about 30% equities, 55% bonds, and 15% real assets.
        </p>

        <div>
          <h3 className="font-semibold text-slate-100">File shape</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>UTF-8 text, one holding per row, with a header row.</li>
            <li>Column names are not case-sensitive, and spaces around a name are ignored.</li>
            <li>
              Column order does not matter, except when a cell contains a comma. Put asset_class
              last, or wrap that cell in double quotes, so the comma stays inside the class.
            </li>
            <li>
              Do not use a thousands separator unless the cell is quoted. 114 is safe. &quot;1,140&quot;
              is safe. An unquoted 1,140 is read as two columns.
            </li>
            <li>A blank line is skipped. A row with fewer cells than the header is rejected.</li>
          </ul>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
            <caption className="mb-2 text-left text-sm font-semibold text-slate-100">Columns</caption>
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="py-2 pr-4 font-semibold">Column</th>
                <th className="py-2 pr-4 font-semibold">Required</th>
                <th className="py-2 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(([name, required, meaning]) => (
                <tr key={name} className="border-b border-slate-800">
                  <td className="py-2 pr-4 font-mono text-indigo-200">{name}</td>
                  <td className="py-2 pr-4">{required}</td>
                  <td className="py-2">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>Any other column, such as currency, is ignored.</p>
        <p>
          Market value is quantity times price. For cash, set current_price to 1 and put the dollar
          amount in quantity.
        </p>

        <div>
          <h3 className="font-semibold text-slate-100">Prices</h3>
          <p className="mt-2">
            Equity rows must use a ticker the market-data provider can price. The file still needs
            current_price, and the upload replaces it with the last completed session close.
          </p>
          <p className="mt-2">
            Bond, commodity, gold, and cash rows keep the current_price from the file. Those
            tickers still need price history from the market-data provider before a risk run,
            except CASH, USD, and USD-CASH.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
            <caption className="mb-2 text-left text-sm font-semibold text-slate-100">
              Class labels
            </caption>
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="py-2 pr-4 font-semibold">Words</th>
                <th className="py-2 pr-4 font-semibold">Slice</th>
                <th className="py-2 font-semibold">Price used</th>
              </tr>
            </thead>
            <tbody>
              {classes.map(([words, slice, price]) => (
                <tr key={words} className="border-b border-slate-800">
                  <td className="py-2 pr-4">{words}</td>
                  <td className="py-2 pr-4">{slice}</td>
                  <td className="py-2">{price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          The first class word in asset_class chooses the slice. Matching ignores case. A longer
          label is fine when the class word comes first, for example Bond, U.S., Long-Term. Quote
          that cell.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">
          {`ticker,quantity,current_price,asset_name,asset_class
TLT,5034,79.46,iShares 20+ Year Treasury,"Bond, U.S., Long-Term"`}
        </pre>

        <div>
          <h3 className="font-semibold text-slate-100">Sample</h3>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">
            {sample}
          </pre>
        </div>
      </Section>
    </div>
  );
}
