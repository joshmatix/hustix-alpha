'use client';

interface Scenario {
  id: string;
  name: string;
  description: string;
  rateChangeBps: number;
  inflationDelta: number;
}

const presetScenarios: Scenario[] = [
  {
    id: 'rate_shock',
    name: '+200bps Rate Hike',
    description: 'Aggressive monetary tightening in response to inflation stickiness.',
    rateChangeBps: 200,
    inflationDelta: 0.5,
  },
  {
    id: 'stagflation',
    name: 'Stagflation Shock',
    description: 'Slowing GDP growth coupled with sustained supply-side price spikes.',
    rateChangeBps: 100,
    inflationDelta: 3.5,
  },
  {
    id: 'soft_landing',
    name: 'Soft Landing Cut',
    description: 'Controlled disinflation prompting moderate central bank rate cuts.',
    rateChangeBps: -100,
    inflationDelta: -1.0,
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
            Calculating Fast-Engine Risk Model...
          </>
        ) : (
          'Run Stress Test Simulation'
        )}
      </button>
    </div>
  );
}