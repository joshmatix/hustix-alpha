'use client';

interface Portfolio {
  id: string;
  client_name: string;
  portfolio_value: number;
  asset_allocation: {
    equities: number;
    bonds: number;
    realAssets: number;
    cash: number;
  };
  created_at?: string;
}

interface PortfolioTableProps {
  portfolios: Portfolio[];
  onSelectPortfolio?: (portfolio: Portfolio) => void;
}

export default function PortfolioTable({ portfolios, onSelectPortfolio }: PortfolioTableProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 className="font-bold text-white text-base">Client Accounts & Portfolios</h2>
        <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">
          {portfolios.length} Accounts
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950/50 text-xs uppercase text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="px-6 py-3.5">Client Name</th>
              <th className="px-6 py-3.5">Portfolio Value</th>
              <th className="px-6 py-3.5">Eq / Bd / Real / Cash</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {portfolios.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                  No portfolios found. Add a client portfolio to begin stress testing.
                </td>
              </tr>
            ) : (
              portfolios.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition">
                  <td className="px-6 py-4 font-medium text-white">{item.client_name}</td>
                  <td className="px-6 py-4 font-semibold text-emerald-400">
                    ${item.portfolio_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <span className="text-indigo-400">{item.asset_allocation.equities}%</span> /{' '}
                    <span className="text-sky-400">{item.asset_allocation.bonds}%</span> /{' '}
                    <span className="text-amber-400">{item.asset_allocation.realAssets}%</span> /{' '}
                    <span className="text-slate-400">{item.asset_allocation.cash}%</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => onSelectPortfolio && onSelectPortfolio(item)}
                      className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white text-xs rounded-md transition"
                    >
                      Analyze Risk
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}