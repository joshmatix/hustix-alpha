'use client';

interface DistributionPanelProps {
  distribution: string;
  onDistribution: (value: string) => void;
  macroShockBps: number;
  onMacroShockBps: (value: number) => void;
  simulations: number;
  onSimulations: (value: number) => void;
  timeHorizonYears: number;
  onTimeHorizonYears: (value: number) => void;
  onRun: () => void;
  isCalculating?: boolean;
}

const fieldClass =
  'w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500';

export default function DistributionPanel({
  distribution,
  onDistribution,
  macroShockBps,
  onMacroShockBps,
  simulations,
  onSimulations,
  timeHorizonYears,
  onTimeHorizonYears,
  onRun,
  isCalculating = false,
}: DistributionPanelProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Distribution model
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Synthetic paths from the portfolio&apos;s live market value.
        </p>
      </div>

      <label className="block text-xs font-medium text-slate-300">
        Distribution
        <select
          value={distribution}
          onChange={(event) => onDistribution(event.target.value)}
          className={`${fieldClass} mt-2`}
        >
          <option value="normal">Normal</option>
          <option value="student_t">Student&apos;s t (fat tails)</option>
          <option value="bootstrap">Bootstrap</option>
        </select>
      </label>

      <label className="block text-xs font-medium text-slate-300">
        Yield shock (bps)
        <input
          type="number"
          value={macroShockBps}
          onChange={(event) => onMacroShockBps(Number(event.target.value))}
          className={`${fieldClass} mt-2`}
        />
      </label>

      <label className="block text-xs font-medium text-slate-300">
        Paths
        <select
          value={simulations}
          onChange={(event) => onSimulations(Number(event.target.value))}
          className={`${fieldClass} mt-2`}
        >
          <option value={5000}>5,000</option>
          <option value={10000}>10,000</option>
          <option value={50000}>50,000</option>
        </select>
      </label>

      <label className="block text-xs font-medium text-slate-300">
        Horizon (years)
        <select
          value={timeHorizonYears}
          onChange={(event) => onTimeHorizonYears(Number(event.target.value))}
          className={`${fieldClass} mt-2`}
        >
          <option value={1}>1</option>
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={30}>30</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onRun}
        disabled={isCalculating}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/50 text-white font-semibold text-xs rounded-lg transition"
      >
        {isCalculating ? 'Marking to live prices...' : 'Run distribution'}
      </button>
    </div>
  );
}
