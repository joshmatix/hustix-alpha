'use client';

import { useEffect, useRef } from 'react';

interface Portfolio {
  id: string;
  client_name: string;
  account_number?: string | null;
  sub_account_number?: string | null;
  portfolio_value: number;
  asset_allocation: {
    equities: number;
    bonds: number;
    realAssets: number;
    cash: number;
  };
  created_at?: string;
  selected: boolean;
}

interface PortfolioTableProps {
  portfolios: Portfolio[];
  emptyMessage?: string;
  onTogglePortfolio: (portfolioId: string) => void;
  onToggleAll: (selected: boolean) => void;
  onSelectPortfolio?: (portfolio: Portfolio) => void;
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 accent-indigo-500 disabled:opacity-40"
    />
  );
}

export default function PortfolioTable({
  portfolios,
  emptyMessage = 'Add a client portfolio to begin stress testing.',
  onTogglePortfolio,
  onToggleAll,
  onSelectPortfolio,
}: PortfolioTableProps) {
  const selectedCount = portfolios.filter((item) => item.selected).length;
  const allSelected = portfolios.length > 0 && selectedCount === portfolios.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 className="font-bold text-white text-base">Client Accounts & Portfolios</h2>
        <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">
          {selectedCount} of {portfolios.length} selected
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950/50 text-xs uppercase text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="w-12 px-4 py-3.5">
                <SelectionCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={portfolios.length === 0}
                  label="Select all visible portfolios"
                  onChange={onToggleAll}
                />
              </th>
              <th className="px-6 py-3.5">Client Name</th>
              <th className="px-6 py-3.5">Portfolio Value</th>
              <th className="px-6 py-3.5">Eq / Bd / Real / Cash</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {portfolios.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              portfolios.map((item) => (
                <tr
                  key={item.id}
                  className={`transition ${item.selected ? 'bg-indigo-500/5 hover:bg-slate-800/40' : 'opacity-60 hover:bg-slate-800/20'}`}
                >
                  <td className="px-4 py-4">
                    <SelectionCheckbox
                      checked={item.selected}
                      label={`Include ${item.client_name} in the allocation pool`}
                      onChange={() => onTogglePortfolio(item.id)}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-white">{item.client_name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {item.account_number?.trim() ? `Client Master ID ${item.account_number.trim()}` : 'No Client Master ID'}
                      {item.sub_account_number?.trim() ? ` · Sub-Account ${item.sub_account_number.trim()}` : ''}
                    </div>
                  </td>
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
