'use client';

interface AssetAllocationProps {
  allocation: {
    equities: number;
    bonds: number;
    realAssets: number;
    cash: number;
  };
  dollars?: {
    equities: number;
    bonds: number;
    realAssets: number;
    cash: number;
  };
  totalValue?: number;
  selectedCount?: number;
  availableCount?: number;
}

function formatShare(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMoney(value: number) {
  return `$${Math.max(0, value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AssetAllocationChart({
  allocation,
  dollars,
  totalValue = 0,
  selectedCount = 0,
  availableCount = 0,
}: AssetAllocationProps) {
  const assets = [
    { label: 'Equities', percentage: allocation.equities, dollars: dollars?.equities ?? 0, color: 'bg-indigo-500' },
    { label: 'Fixed Income (Bonds)', percentage: allocation.bonds, dollars: dollars?.bonds ?? 0, color: 'bg-sky-500' },
    { label: 'Real Assets / Commodities', percentage: allocation.realAssets, dollars: dollars?.realAssets ?? 0, color: 'bg-amber-500' },
    { label: 'Cash / Money Market', percentage: allocation.cash, dollars: dollars?.cash ?? 0, color: 'bg-emerald-500' },
  ];
  const scope = selectedCount === availableCount
    ? `${selectedCount} portfolio${selectedCount === 1 ? '' : 's'}`
    : `${selectedCount} of ${availableCount} portfolios`;
  const summary = selectedCount === 0
    ? 'Select portfolios in the table to pool their allocation.'
    : `Weighted share of ${formatMoney(totalValue)} across ${scope}.`;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Asset Allocation Breakdown
      </h3>
      <p className="mt-1 mb-4 text-xs text-slate-500">{summary}</p>

      {/* Allocation Stacked Bar */}
      <div className="w-full h-4 bg-slate-950 rounded-full flex overflow-hidden mb-6 border border-slate-800">
        {assets.map((item) => (
          <div
            key={item.label}
            style={{ width: `${Math.max(0, item.percentage)}%` }}
            className={`${item.color} h-full transition-all duration-500`}
            title={`${item.label}: ${formatShare(item.percentage)}% (${formatMoney(item.dollars)})`}
          />
        ))}
      </div>

      {/* Legend & Percentages */}
      <div className="grid grid-cols-2 gap-3">
        {assets.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-2 text-xs bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-3 w-3 shrink-0 rounded-sm ${item.color}`} />
              <span className="truncate text-slate-300">{item.label}</span>
            </div>
            <span className="font-bold text-white">{formatShare(item.percentage)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
