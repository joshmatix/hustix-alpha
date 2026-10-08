'use client';

interface RiskGaugeProps {
  score: number; // 0 to 100
  label: string;
  projectedLoss?: number;
}

export default function RiskGauge({ score, label, projectedLoss }: RiskGaugeProps) {
  const getSeverityStyle = (val: number) => {
    if (val < 35) {
      return {
        badge: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
        bar: 'bg-emerald-500',
        status: 'Low Risk',
      };
    }
    if (val < 70) {
      return {
        badge: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
        bar: 'bg-amber-500',
        status: 'Moderate Sensitivity',
      };
    }
    return {
      badge: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      bar: 'bg-rose-500',
      status: 'High Vulnerability',
    };
  };

  const severity = getSeverityStyle(score);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
      <div>
        <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
          {label}
        </span>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-extrabold text-white">{score}</span>
          <span className="text-xs text-slate-400">/ 100 Score</span>
        </div>
      </div>

      {/* Progress meter */}
      <div className="my-4">
        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
          <div
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            className={`h-full transition-all duration-700 ${severity.bar}`}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${severity.badge}`}>
            {severity.status}
          </span>
          {projectedLoss !== undefined && (
            <span className="text-rose-400 font-semibold">
              Est. Drawdown: -${projectedLoss.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}