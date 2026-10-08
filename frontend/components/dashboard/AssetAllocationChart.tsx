'use client';

interface AssetAllocationProps {
  allocation: {
    equities: number;
    bonds: number;
    realAssets: number;
    cash: number;
  };
}

export default function AssetAllocationChart({ allocation }: AssetAllocationProps) {
  const assets = [
    { label: 'Equities', percentage: allocation.equities, color: 'bg-indigo-500' },
    { label: 'Fixed Income (Bonds)', percentage: allocation.bonds, color: 'bg-sky-500' },
    { label: 'Real Assets / Commodities', percentage: allocation.realAssets, color: 'bg-amber-500' },
    { label: 'Cash / Money Market', percentage: allocation.cash, color: 'bg-emerald-500' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Asset Allocation Breakdown
      </h3>

      {/* Allocation Stacked Bar */}
      <div className="w-full h-4 bg-slate-950 rounded-full flex overflow-hidden mb-6 border border-slate-800">
        {assets.map((item, idx) => (
          <div
            key={idx}
            style={{ width: `${item.percentage}%` }}
            className={`${item.color} h-full transition-all duration-500`}
            title={`${item.label}: ${item.percentage}%`}
          />
        ))}
      </div>

      {/* Legend & Percentages */}
      <div className="grid grid-cols-2 gap-3">
        {assets.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between text-xs bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-sm ${item.color}`} />
              <span className="text-slate-300">{item.label}</span>
            </div>
            <span className="font-bold text-white">{item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}