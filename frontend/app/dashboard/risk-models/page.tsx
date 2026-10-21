'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AllocationPie from '@/components/dashboard/AllocationPie';
import DistributionPanel from '@/components/dashboard/DistributionPanel';
import MacroScenarioPicker, {
  defaultAdvisorShock,
  shockRequest,
  type AdvisorShock,
} from '@/components/dashboard/MacroScenarioPicker';
import Button from '@/components/ui/Button';
import { apiFetch, type Holding, type Portfolio } from '@/lib/api';
import { chooseAdvisorReportDestination, saveReportBlob } from '@/lib/saveReportFile';

type HistoryResults = {
  kind: 'history';
  overallScore: number;
  equityDrawdown: number;
  bondImpact: number;
  realAssetHedge: number;
  unclassifiedImpact: number | null;
  var95: number;
  narrative: string;
  fallbackNote: string;
  fallbackLabel: string;
};

type DistributionResults = {
  kind: 'distribution';
  startingValue: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  var95: number;
  var99: number;
  expectedShortfall: number;
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function classImpact(assetClass: string, results: HistoryResults | null) {
  if (!results) return null;
  const key = assetClass.toLowerCase();
  if (key.includes('bond') || key.includes('fixed')) return results.bondImpact;
  if (key.includes('real') || key.includes('commod')) return results.realAssetHedge;
  if (key.includes('cash')) return 0;
  if (key.includes('unclass')) return results.unclassifiedImpact;
  return results.equityDrawdown;
}

function densityPoints(results: DistributionResults, startingValue: number) {
  const knots = [
    { x: results.p5, cdf: 0.05 },
    { x: results.p25, cdf: 0.25 },
    { x: results.p50, cdf: 0.5 },
    { x: results.p75, cdf: 0.75 },
    { x: results.p95, cdf: 0.95 },
  ];
  for (let index = 1; index < knots.length; index += 1) {
    if (knots[index].x <= knots[index - 1].x) knots[index].x = knots[index - 1].x + 1;
  }
  const densities = knots.map((knot, index) => {
    const previous = knots[index - 1];
    const next = knots[index + 1];
    const leftSpacing = previous ? (knot.x - previous.x) / (knot.cdf - previous.cdf) : 0;
    const rightSpacing = next ? (next.x - knot.x) / (next.cdf - knot.cdf) : 0;
    const spacing = leftSpacing && rightSpacing ? (leftSpacing + rightSpacing) / 2 : leftSpacing || rightSpacing;
    return { x: knot.x, y: 1 / Math.max(spacing, 1e-9) };
  });
  const span = Math.max(knots[knots.length - 1].x - knots[0].x, 1);
  const left = Math.min(knots[0].x - span * 0.12, startingValue);
  const right = Math.max(knots[knots.length - 1].x + span * 0.12, startingValue);
  return {
    left,
    right,
    samples: [{ x: left, y: 0 }, ...densities, { x: right, y: 0 }],
  };
}

function smoothCurve(points: Array<{ x: number; y: number }>, floor: number, ceiling: number) {
  const clamp = (value: number) => Math.min(Math.max(value, ceiling), floor);
  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    commands.push(
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    );
  }
  return commands.join(' ');
}

function DistributionChart({
  startingValue,
  results,
  onRun,
  running,
  runDisabled,
}: {
  startingValue: number | null;
  results: DistributionResults | null;
  onRun: () => void;
  running: boolean;
  runDisabled: boolean;
}) {
  if (!results || startingValue == null) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-6 text-center text-sm text-slate-400">
        <p className="max-w-full leading-6">
          <button
            type="button"
            onClick={onRun}
            disabled={runDisabled}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 align-baseline text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-800/50"
          >
            {running ? 'Running...' : '▶ Run Risk Analysis'}
          </button>{' '}
          to compare today&apos;s value with the shocked ending-value distribution.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 168;
  const pad = { top: 16, right: 12, bottom: 28, left: 12 };
  const { left, right, samples } = densityPoints(results, startingValue);
  const peak = Math.max(...samples.map((sample) => sample.y));
  const plotBottom = height - pad.bottom;
  const xOf = (value: number) =>
    pad.left + ((value - left) / Math.max(right - left, 1)) * (width - pad.left - pad.right);
  const yOf = (density: number) => pad.top + (1 - (density / peak) * 0.9) * (plotBottom - pad.top);
  const plotted = samples.map((sample) => ({ x: xOf(sample.x), y: yOf(sample.y) }));
  const line = smoothCurve(plotted, plotBottom, pad.top);
  const area = `${line} L ${plotted[plotted.length - 1].x.toFixed(1)} ${plotBottom.toFixed(1)} L ${plotted[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`;
  const baseline = xOf(startingValue);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Baseline value and shocked ending-value distribution">
        <path d={area} fill="rgba(99, 102, 241, 0.25)" />
        <path d={line} fill="none" stroke="#818cf8" strokeWidth="2" />
        <line x1={baseline} x2={baseline} y1={pad.top} y2={height - pad.bottom} stroke="#34d399" strokeWidth="2" />
        <text x={baseline + 6} y={pad.top + 12} fill="#6ee7b7" fontSize="11">
          Today
        </text>
        <text x={pad.left} y={height - 8} fill="#94a3b8" fontSize="11">
          {money.format(left)}
        </text>
        <text x={width - pad.right} y={height - 8} fill="#94a3b8" fontSize="11" textAnchor="end">
          {money.format(right)}
        </text>
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Baseline
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          Shocked
        </span>
      </div>
    </div>
  );
}

function RiskModelsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portfolioId = searchParams.get('portfolio');
  const [shock, setShock] = useState<AdvisorShock>(defaultAdvisorShock);
  const [distribution, setDistribution] = useState('student_t');
  const [macroShockBps, setMacroShockBps] = useState(200);
  const [simulations, setSimulations] = useState(10000);
  const [timeHorizonYears, setTimeHorizonYears] = useState(5);
  const [isCalculating, setIsCalculating] = useState(false);
  const [reporting, setReporting] = useState<'client' | 'advisor' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [historyResults, setHistoryResults] = useState<HistoryResults | null>(null);
  const [distributionResults, setDistributionResults] = useState<DistributionResults | null>(null);

  useEffect(() => {
    apiFetch('/api/portfolios')
      .then(async (res) => {
        if (!res.ok) return;
        setPortfolios(await res.json());
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setError(null);
    setHistoryResults(null);
    setDistributionResults(null);
    setHoldings([]);
    if (!portfolioId) {
      setPortfolio(null);
      return;
    }
    apiFetch(`/api/portfolios/${portfolioId}`)
      .then(async (res) => {
        if (!res.ok) return;
        setPortfolio(await res.json());
      })
      .catch(() => undefined);
    apiFetch(`/api/portfolios/${portfolioId}/holdings`)
      .then(async (res) => {
        if (!res.ok) return;
        setHoldings(await res.json());
      })
      .catch(() => undefined);
  }, [portfolioId]);

  const handleRunSimulation = async () => {
    if (!portfolioId) {
      throw new Error('Choose a portfolio before running a stress test.');
    }
    const res = await apiFetch('/api/v1/simulate', {
        method: 'POST',
        body: JSON.stringify({
          portfolio_id: portfolioId,
          ...shockRequest(shock),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || 'Simulation failed.');
      }
      const unclassifiedValue = Number(body.class_values?.Unclassified ?? 0);
      const fallbackHoldings = Array.isArray(body.fallback_holdings) ? body.fallback_holdings : [];
      setHistoryResults({
        kind: 'history',
        overallScore: Number(body.overall_score ?? 50),
        equityDrawdown: Number(body.asset_impacts?.Equities ?? 0),
        bondImpact: Number(body.asset_impacts?.Bonds ?? 0),
        realAssetHedge: Number(body.asset_impacts?.Real_Assets ?? 0),
        unclassifiedImpact: unclassifiedValue > 0 ? Number(body.asset_impacts?.Unclassified ?? 0) : null,
        var95: Math.abs(Math.round(Number(body.var_95_loss ?? 0))),
        narrative: body.narrative || '',
        fallbackNote: body.fallback_note || '',
        fallbackLabel: fallbackHoldings
          .map((row: { ticker?: string; method_label?: string }) => `${row.ticker} (${row.method_label})`)
          .join(', '),
      });
  };

  const handleRunDistribution = async () => {
    if (!portfolioId) {
      throw new Error('Choose a portfolio before running the risk analysis.');
    }
    const res = await apiFetch('/api/v1/distribution-simulate', {
        method: 'POST',
        body: JSON.stringify({
          portfolio_id: portfolioId,
          simulations,
          time_horizon_years: timeHorizonYears,
          distribution_model: distribution,
          macro_shock_bps: macroShockBps,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || 'Risk analysis failed.');
      }
      const metrics = body.metrics || {};
      setDistributionResults({
        kind: 'distribution',
        startingValue: Number(body.starting_value ?? 0),
        p5: Number(metrics.p5 ?? 0),
        p25: Number(metrics.p25 ?? 0),
        p50: Number(metrics.p50 ?? 0),
        p75: Number(metrics.p75 ?? 0),
        p95: Number(metrics.p95 ?? 0),
        var95: Number(metrics.var_95 ?? 0),
        var99: Number(metrics.var_99 ?? 0),
        expectedShortfall: Number(metrics.expected_shortfall_95 ?? 0),
      });
  };

  const handleRunWorkspace = async () => {
    if (!portfolioId) {
      setError('Choose a portfolio before running the risk analysis.');
      return;
    }
    const portfolioValue = Number(portfolio?.portfolio_value ?? 0);
    if (portfolioValue <= 0) {
      setError('Upload holdings before running the risk analysis. This account has no value yet.');
      return;
    }
    const yieldError = shock.yieldBps < -1000 || shock.yieldBps > 1000;
    const equityError = !shock.useWorstEquityWindow && (shock.equityPct < -80 || shock.equityPct > 100);
    if (!Number.isFinite(shock.yieldBps) || !Number.isFinite(shock.equityPct) || yieldError || equityError) {
      setError('Yield moves stay between -1000 and 1000 bp. S&P moves stay between -80% and 100%.');
      return;
    }
    setIsCalculating(true);
    setError(null);
    const [monteCarlo, stress] = await Promise.allSettled([handleRunDistribution(), handleRunSimulation()]);
    const messages = [monteCarlo, stress].flatMap((result) =>
      result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : 'Simulation failed.'] : [],
    );
    if (messages.length) setError(messages.join(' '));
    setIsCalculating(false);
  };

  const handleDownloadReport = async (audience: 'client' | 'advisor') => {
    if (!portfolioId) {
      setError('Choose a portfolio before downloading a report.');
      return;
    }
    const portfolioValue = Number(portfolio?.portfolio_value ?? 0);
    if (portfolioValue <= 0) {
      setError('Upload holdings before downloading a report. This account has no value yet.');
      return;
    }
    if (!Number.isFinite(shock.yieldBps) || !Number.isFinite(shock.equityPct)) {
      setError('Enter a yield move and an S&P move before downloading a report.');
      return;
    }
    setReporting(audience);
    setError(null);
    try {
      const safeName = (portfolio?.name || 'portfolio').replace(/[^\w.-]+/g, '-');
      const filename = `${safeName}-${audience}-report.pdf`;
      const destination = audience === 'advisor'
        ? await chooseAdvisorReportDestination(portfolioId, filename)
        : { kind: 'download' as const };
      if (destination === 'cancelled') return;

      const res = await apiFetch('/api/v1/report', {
        method: 'POST',
        body: JSON.stringify({
          portfolio_id: portfolioId,
          audience,
          distribution_model: distribution,
          macro_shock_bps: macroShockBps,
          simulations,
          time_horizon_years: timeHorizonYears,
          ...shockRequest(shock),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'Could not create the report.');
      }
      const blob = await res.blob();
      await saveReportBlob(destination, filename, blob, audience === 'advisor' ? portfolioId : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the report.');
    } finally {
      setReporting(null);
    }
  };

  const invested = holdings.reduce((sum, holding) => sum + Number(holding.market_value || 0), 0);
  const tickerRows = [...holdings].sort(
    (left, right) => Number(right.market_value || 0) - Number(left.market_value || 0),
  );
  const selectedAccount = portfolios.find((item) => item.id === portfolioId)?.internal_account_number?.trim() || '';
  const accountPortfolios = selectedAccount
    ? portfolios.filter((item) => item.internal_account_number?.trim() === selectedAccount)
    : portfolios;
  const yieldError = shock.yieldBps < -1000 || shock.yieldBps > 1000;
  const equityError = !shock.useWorstEquityWindow && (shock.equityPct < -80 || shock.equityPct > 100);
  const runDisabled =
    isCalculating ||
    !portfolioId ||
    yieldError ||
    equityError ||
    !Number.isFinite(shock.yieldBps) ||
    !Number.isFinite(shock.equityPct);

  return (
    <div className="-mt-3 grid grid-cols-1 gap-6 sm:-mt-5 md:h-[calc(100vh-7.5rem)] md:grid-cols-12">
      <aside className="space-y-4 self-start overflow-y-auto md:col-span-5 md:max-h-full lg:col-span-4 xl:col-span-3">
        <div>
          <label className="block text-xs font-medium text-slate-400" htmlFor="risk-portfolio">
            Portfolio
          </label>
          <select
            id="risk-portfolio"
            value={portfolioId || ''}
            onChange={(event) => {
              const nextId = event.target.value;
              setError(null);
              router.push(nextId ? `/dashboard/risk-models?portfolio=${nextId}` : '/dashboard/risk-models');
            }}
            className={`mt-1 w-full rounded-md border bg-slate-950 p-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none ${
              portfolioId ? 'border-slate-700' : 'animate-heartbeat border-slate-600'
            }`}
          >
            <option value="">Select a portfolio</option>
            {accountPortfolios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Portfolio mix</h2>
          <AllocationPie allocation={portfolio?.asset_allocation ?? null} compact />
          {tickerRows.length === 0 ? (
            <p className="text-xs text-slate-400">Ticker weights appear after you select a portfolio with holdings.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto">
              <table className="w-full text-left text-[11px] text-slate-300">
                <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Ticker</th>
                    <th className="py-1 pr-2 font-medium">Class</th>
                    <th className="py-1 text-right font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {tickerRows.map((holding) => {
                    const weight = invested > 0 ? (Number(holding.market_value) / invested) * 100 : 0;
                    return (
                      <tr key={holding.holding_id} className="border-t border-slate-800/80">
                        <td className="py-1 pr-2 font-medium text-white">{holding.ticker}</td>
                        <td className="py-1 pr-2 text-slate-400">{holding.asset_class}</td>
                        <td className="py-1 text-right font-mono">{weight.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <MacroScenarioPicker shock={shock} onShock={setShock} />
        <DistributionPanel
          distribution={distribution}
          onDistribution={setDistribution}
          macroShockBps={macroShockBps}
          onMacroShockBps={setMacroShockBps}
          simulations={simulations}
          onSimulations={setSimulations}
          timeHorizonYears={timeHorizonYears}
          onTimeHorizonYears={setTimeHorizonYears}
        />

        <button
          type="button"
          onClick={handleRunWorkspace}
          disabled={runDisabled}
          className="sticky bottom-0 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:bg-indigo-800/50"
        >
          {isCalculating ? 'Running risk analysis...' : '▶ Run Risk Analysis'}
        </button>
      </aside>

      <section className="flex min-h-0 flex-col gap-4 md:col-span-7 md:max-h-full md:overflow-y-auto lg:col-span-8 xl:col-span-9">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Simulation output</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {portfolio
                ? `${portfolio.name} · $${Number(portfolio.portfolio_value).toLocaleString()}`
                : 'Choose a portfolio, then run the risk analysis.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownloadReport('client')}
              isLoading={reporting === 'client'}
              disabled={reporting !== null}
            >
              Client Report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownloadReport('advisor')}
              isLoading={reporting === 'advisor'}
              disabled={reporting !== null}
            >
              Advisor Report
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-white">Monte Carlo probability distribution</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Baseline value against the shocked ending-value distribution.</p>
          <div className="mt-2">
            <DistributionChart
              startingValue={distributionResults?.startingValue ?? (portfolio ? Number(portfolio.portfolio_value) : null)}
              results={distributionResults}
              onRun={handleRunWorkspace}
              running={isCalculating}
              runDisabled={runDisabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">VaR 95%</p>
            <p className="mt-1 text-2xl font-bold text-rose-400">
              {distributionResults ? money.format(distributionResults.var95) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">VaR 99%</p>
            <p className="mt-1 text-2xl font-bold text-rose-400">
              {distributionResults ? money.format(distributionResults.var99) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">CVaR / Expected shortfall</p>
            <p className="mt-1 text-2xl font-bold text-rose-300">
              {distributionResults ? money.format(distributionResults.expectedShortfall) : '—'}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Asset-level factor risk attribution</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Weight, market beta, and rate duration. Class impact fills in after the stress pricing.
            </p>
          </div>
          {tickerRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Select a portfolio to see holding-level factors.</p>
          ) : (
            <div className="max-h-64 overflow-auto lg:max-h-none">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950/90 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Ticker</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 text-right font-medium">Beta</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Market</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Class impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {tickerRows.map((holding) => {
                    const weight = invested > 0 ? Number(holding.market_value) / invested : 0;
                    const beta = Number(holding.beta || 0);
                    const duration = Number(holding.duration_years || 0);
                    const impact = classImpact(holding.asset_class, historyResults);
                    return (
                      <tr key={holding.holding_id}>
                        <td className="px-4 py-2 font-medium text-white">{holding.ticker}</td>
                        <td className="px-3 py-2 text-right font-mono">{(weight * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right font-mono">{beta.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{duration.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-mono">{(weight * beta).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{(weight * duration).toFixed(2)}</td>
                        <td
                          className={`px-4 py-2 text-right font-mono ${
                            impact == null ? 'text-slate-500' : impact < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {impact == null ? '—' : `${impact > 0 ? '+' : ''}${impact}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {historyResults?.fallbackNote && (
            <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-amber-200/90">{historyResults.fallbackNote}</p>
          )}
        </div>
      </section>
    </div>
  );
}

export default function RiskModelsRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading risk models...</p>}>
      <RiskModelsPage />
    </Suspense>
  );
}
