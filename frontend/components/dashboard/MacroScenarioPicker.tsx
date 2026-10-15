'use client';

interface Scenario {
  id: string;
  name: string;
  description: string;
  rateChangeBps: number;
}

const presetScenarios: Scenario[] = [
  {
    id: 'rate_shock',
    name: '+200bps Rate Hike',
    description:
      'Yields rise 200 basis points and reprice the book once. Equity sensitivity is the partial beta to the 10-year after controlling for the S&P.',
    rateChangeBps: 200,
  },
  {
    id: 'stagflation',
    name: 'Stagflation Shock',
    description:
      "Yields rise 100 basis points, and the worst three-month S&P move is applied through each holding's partial beta to yields and the market.",
    rateChangeBps: 100,
  },
  {
    id: 'soft_landing',
    name: 'Soft Landing Cut',
    description:
      'Yields fall 100 basis points and reprice the book once. Bonds use duration and convexity. Equities use a market-controlled yield beta. Cash is not repriced.',
    rateChangeBps: -100,
  },
];

interface MacroScenarioPickerProps {
  selectedScenarioId: string;
  onSelectScenario: (scenario: Scenario) => void;
  onRunSimulation: () => void;
  isCalculating?: boolean;
}

export default function MacroScenarioPicker({
  selectedScenarioId,
  onSelectScenario,
  onRunSimulation,
  isCalculating = false,
}: MacroScenarioPickerProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Macroeconomic Stress Testing
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Select a macro scenario to model capital impact using the FastAPI backend.
        </p>
      </div>

      <div className="space-y-2">
        {presetScenarios.map((sc) => {
          const isSelected = sc.id === selectedScenarioId;
          return (
            <button
              key={sc.id}
              onClick={() => onSelectScenario(sc)}
              className={`w-full text-left p-3.5 rounded-lg border text-xs transition flex flex-col gap-1 ${
                isSelected
                  ? 'bg-indigo-950/40 border-indigo-500 text-white'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-bold text-sm text-white">{sc.name}</span>
                <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300">
                  {sc.rateChangeBps > 0 ? `+${sc.rateChangeBps}` : sc.rateChangeBps}bps
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">{sc.description}</p>
            </button>
          );
        })}
      </div>

      <button
        onClick={onRunSimulation}
        disabled={isCalculating}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/50 text-white font-semibold text-xs rounded-lg transition flex items-center justify-center gap-2"
      >
        {isCalculating ? (
          <>
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Pricing from live market history...
          </>
        ) : (
          'Run live stress test'
        )}
      </button>
    </div>
  );
}