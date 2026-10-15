'use client';

export interface AdvisorShock {
  yieldBps: number;
  equityPct: number;
  useWorstEquityWindow: boolean;
}

export const defaultAdvisorShock: AdvisorShock = {
  yieldBps: 200,
  equityPct: 0,
  useWorstEquityWindow: false,
};

const presets: Array<AdvisorShock & { id: string; name: string; description: string }> = [
  {
    id: 'rate_shock',
    name: '+200bps Rate Hike',
    description:
      'Yields rise 200 basis points and reprice the book once. Equity sensitivity is the partial beta to the 10-year after controlling for the S&P.',
    yieldBps: 200,
    equityPct: 0,
    useWorstEquityWindow: false,
  },
  {
    id: 'stagflation',
    name: 'Stagflation Shock',
    description:
      "Yields rise 100 basis points, and the worst three-month S&P move is applied through each holding's partial beta to yields and the market.",
    yieldBps: 100,
    equityPct: 0,
    useWorstEquityWindow: true,
  },
  {
    id: 'soft_landing',
    name: 'Soft Landing Cut',
    description:
      'Yields fall 100 basis points and reprice the book once. Bonds use duration and convexity. Equities use a market-controlled yield beta. Cash is not repriced.',
    yieldBps: -100,
    equityPct: 0,
    useWorstEquityWindow: false,
  },
];

export function shockRequest(shock: AdvisorShock) {
  const matched = selectedPresetId(shock);
  const scenario =
    matched === 'rate_shock'
      ? 'Rate_Shock'
      : matched === 'stagflation'
        ? 'Stagflation'
        : matched === 'soft_landing'
          ? 'Soft_Landing'
          : 'Custom';
  return {
    scenario,
    yield_bps: shock.yieldBps,
    equity_pct: shock.equityPct,
    use_worst_equity_window: shock.useWorstEquityWindow,
  };
}

function selectedPresetId(shock: AdvisorShock) {
  return presets.find(
    (preset) =>
      preset.yieldBps === shock.yieldBps &&
      preset.useWorstEquityWindow === shock.useWorstEquityWindow &&
      (shock.useWorstEquityWindow || preset.equityPct === shock.equityPct),
  )?.id ?? 'custom';
}

interface MacroScenarioPickerProps {
  shock: AdvisorShock;
  onShock: (shock: AdvisorShock) => void;
  onRunSimulation: () => void;
  isCalculating?: boolean;
}

export default function MacroScenarioPicker({
  shock,
  onShock,
  onRunSimulation,
  isCalculating = false,
}: MacroScenarioPickerProps) {
  const selectedId = selectedPresetId(shock);
  const yieldError = shock.yieldBps < -1000 || shock.yieldBps > 1000;
  const equityError = !shock.useWorstEquityWindow && (shock.equityPct < -80 || shock.equityPct > 100);

  const update = (next: Partial<AdvisorShock>) => {
    onShock({ ...shock, ...next });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Macroeconomic Stress Testing
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Start from a preset, or set the 10-year move and the S&P move yourself.
        </p>
      </div>

      <div className="space-y-2">
        {presets.map((preset) => {
          const isSelected = preset.id === selectedId;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onShock({
                  yieldBps: preset.yieldBps,
                  equityPct: preset.equityPct,
                  useWorstEquityWindow: preset.useWorstEquityWindow,
                })
              }
              className={`w-full text-left p-3.5 rounded-lg border text-xs transition flex flex-col gap-1 ${
                isSelected
                  ? 'bg-indigo-950/40 border-indigo-500 text-white'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-bold text-sm text-white">{preset.name}</span>
                <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300">
                  {preset.yieldBps > 0 ? `+${preset.yieldBps}` : preset.yieldBps}bp
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">{preset.description}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[11px] text-slate-400">
          10-year move (bp)
          <input
            type="number"
            min={-1000}
            max={1000}
            step={10}
            value={shock.yieldBps}
            onChange={(event) => update({ yieldBps: Number(event.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="block text-[11px] text-slate-400">
          S&P move (%)
          <input
            type="number"
            min={-80}
            max={100}
            step={1}
            value={shock.useWorstEquityWindow ? '' : shock.equityPct}
            disabled={shock.useWorstEquityWindow}
            onChange={(event) =>
              update({
                equityPct: Number(event.target.value),
                useWorstEquityWindow: false,
              })
            }
            placeholder={shock.useWorstEquityWindow ? 'Worst 3 months' : '0'}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:text-slate-500"
          />
        </label>
      </div>

      <label className="flex items-start gap-2 text-[11px] text-slate-400">
        <input
          type="checkbox"
          checked={shock.useWorstEquityWindow}
          onChange={(event) => update({ useWorstEquityWindow: event.target.checked, equityPct: 0 })}
          className="mt-0.5"
        />
        <span>Use the worst three-month S&P move in this book&apos;s price history.</span>
      </label>

      {selectedId === 'custom' && (
        <p className="text-[11px] text-slate-400 leading-snug">
          A cut with no S&P move prices bonds from duration and convexity. An S&P move prices each holding from its betas to yields and the market.
        </p>
      )}
      {(yieldError || equityError) && (
        <p className="text-[11px] text-rose-300">
          Yield moves stay between -1000 and 1000 bp. S&P moves stay between -80% and 100%.
        </p>
      )}

      <button
        type="button"
        onClick={onRunSimulation}
        disabled={isCalculating || yieldError || equityError || Number.isNaN(shock.yieldBps)}
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
