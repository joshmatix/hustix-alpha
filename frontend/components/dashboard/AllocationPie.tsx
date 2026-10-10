'use client';

import type { AssetAllocation } from '@/lib/api';

const SLICES = [
  { key: 'equities', label: 'Equities', color: '#6366f1' },
  { key: 'bonds', label: 'Fixed Income', color: '#0ea5e9' },
  { key: 'realAssets', label: 'Real Assets', color: '#f59e0b' },
  { key: 'cash', label: 'Cash', color: '#10b981' },
] as const;

function slicePath(start: number, end: number) {
  const radius = 68;
  const center = 80;
  const toPoint = (share: number) => {
    const angle = share * Math.PI * 2 - Math.PI / 2;
    return [center + radius * Math.cos(angle), center + radius * Math.sin(angle)];
  };
  const [x1, y1] = toPoint(start);
  const [x2, y2] = toPoint(end);
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

export default function AllocationPie({ allocation }: { allocation: AssetAllocation | null }) {
  const parts = SLICES.map((slice) => ({
    ...slice,
    value: Math.max(0, Number(allocation?.[slice.key] ?? 0)),
  }));
  const total = parts.reduce((sum, part) => sum + part.value, 0);

  let cursor = 0;
  const wedges = parts
    .filter((part) => part.value > 0 && total > 0)
    .map((part) => {
      const start = cursor / total;
      cursor += part.value;
      const end = cursor / total;
      return { ...part, start, end };
    });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Portfolio Mix
      </h3>
      {!allocation || total <= 0 ? (
        <p className="mt-4 text-sm text-slate-400">Select a portfolio to see its allocation.</p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0" role="img" aria-label="Portfolio allocation pie chart">
            {wedges.length === 1 ? (
              <circle cx="80" cy="80" r="68" fill={wedges[0].color} />
            ) : (
              wedges.map((wedge) => (
                <path key={wedge.key} d={slicePath(wedge.start, wedge.end)} fill={wedge.color}>
                  <title>{`${wedge.label}: ${wedge.value}%`}</title>
                </path>
              ))
            )}
          </svg>
          <div className="grid w-full grid-cols-1 gap-2">
            {parts.map((part) => (
              <div key={part.key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: part.color }} />
                  {part.label}
                </span>
                <span className="font-semibold text-white">{part.value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
