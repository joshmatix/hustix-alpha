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
import RiskGauge from '@/components/dashboard/RiskGauge';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { apiFetch, type Portfolio } from '@/lib/api';
import { chooseAdvisorReportDestination, saveReportBlob } from '@/lib/saveReportFile';

type Engine = 'history' | 'distribution';

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
  expectedShortfall: number;
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function RiskModelsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portfolioId = searchParams.get('portfolio');
  const [engine, setEngine] = useState<Engine>('history');
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
  const [simulationResults, setSimulationResults] = useState<HistoryResults | DistributionResults | null>(null);

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
    setSimulationResults(null);
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
  }, [portfolioId]);

  const handleRunSimulation = async () => {
    if (!portfolioId) {
      setError('Choose a portfolio before running a stress test.');
      return;
    }
    const portfolioValue = Number(portfolio?.portfolio_value ?? 0);
    if (portfolioValue <= 0) {
      setError('Upload holdings before running a stress test. This account has no value yet.');
      return;
    }
    if (!Number.isFinite(shock.yieldBps) || !Number.isFinite(shock.equityPct)) {
      setError('Enter a yield move and an S&P move before running a stress test.');
      return;
    }
    setIsCalculating(true);
    setError(null);
    try {
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
      setSimulationResults({
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the risk engine.');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleRunDistribution = async () => {
    if (!portfolioId) {
      setError('Choose a portfolio before running a distribution.');
      return;
    }
    setIsCalculating(true);
    setError(null);
    try {
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
        throw new Error(body.detail || 'Distribution run failed.');
      }
      const metrics = body.metrics || {};
      setSimulationResults({
        kind: 'distribution',
        startingValue: Number(body.starting_value ?? 0),
        p5: Number(metrics.p5 ?? 0),
        p25: Number(metrics.p25 ?? 0),
        p50: Number(metrics.p50 ?? 0),
        p75: Number(metrics.p75 ?? 0),
        p95: Number(metrics.p95 ?? 0),
        var95: Number(metrics.var_95 ?? 0),
        expectedShortfall: Number(metrics.expected_shortfall_95 ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the risk engine.');
    } finally {
      setIsCalculating(false);
    }
  };

  const selectEngine = (next: Engine) => {
    setEngine(next);
    setSimulationResults(null);
    setError(null);
  };

  const historyResults = simulationResults?.kind === 'history' ? simulationResults : null;
  const distributionResults = simulationResults?.kind === 'distribution' ? simulationResults : null;

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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-white">Macroeconomic Risk Modeling</h1>
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
        <p className="text-xs text-slate-400 mt-1">
          {portfolio
            ? `Stress testing ${portfolio.name} ($${Number(portfolio.portfolio_value).toLocaleString()}).`
            : 'Choose a portfolio, then price a shock from its live holdings.'}
        </p>
        <label className="mt-4 block text-xs font-medium text-slate-400" htmlFor="risk-portfolio">
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
          className="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Select a portfolio</option>
          {portfolios.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => selectEngine('history')}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${
                engine === 'history' ? 'bg-indigo-600 text-white' : 'text-slate-400'
              }`}
            >
              Market history
            </button>
            <button
              type="button"
              onClick={() => selectEngine('distribution')}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${
                engine === 'distribution' ? 'bg-indigo-600 text-white' : 'text-slate-400'
              }`}
            >
              Distribution
            </button>
          </div>

          {engine === 'history' ? (
            <MacroScenarioPicker
              shock={shock}
              onShock={setShock}
              onRunSimulation={handleRunSimulation}
              isCalculating={isCalculating}
            />
          ) : (
            <DistributionPanel
              distribution={distribution}
              onDistribution={setDistribution}
              macroShockBps={macroShockBps}
              onMacroShockBps={setMacroShockBps}
              simulations={simulations}
              onSimulations={setSimulations}
              timeHorizonYears={timeHorizonYears}
              onTimeHorizonYears={setTimeHorizonYears}
              onRun={handleRunDistribution}
              isCalculating={isCalculating}
            />
          )}
        </div>

        <div className="space-y-6">
          {engine === 'history' && (
            <Card title="Model Parameters" subtitle="Yahoo Finance daily prices, resampled">
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Confidence Interval</span>
                  <span className="text-white font-mono font-semibold">95.0%</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Time Horizon</span>
                  <span className="text-white font-mono font-semibold">12 Months</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Paths</span>
                  <Badge variant="emerald">1,000</Badge>
                </div>
              </div>
            </Card>
          )}
          {engine === 'distribution' && (
            <Card title="Ending-value percentiles" subtitle="Expected shortfall is the average loss in the worst 5%">
              <div className="grid grid-cols-1 gap-4 mt-2">
                {(
                  [
                    ['P5', distributionResults?.p5],
                    ['P25', distributionResults?.p25],
                    ['P75', distributionResults?.p75],
                    ['P95', distributionResults?.p95],
                    ['Shortfall', distributionResults?.expectedShortfall],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">{label}</span>
                    <p className="text-lg font-bold mt-2 text-white">
                      {value === undefined ? '—' : money.format(value)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <AllocationPie allocation={portfolio?.asset_allocation ?? null} />
        </div>

        <div className="space-y-6">
          {engine === 'history' ? (
            <>
              <div className="grid grid-cols-1 gap-4">
                {historyResults ? (
                  <RiskGauge
                    score={historyResults.overallScore}
                    label="Portfolio Vulnerability Index"
                    projectedLoss={historyResults.var95}
                  />
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                    <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                      Portfolio Vulnerability Index
                    </span>
                    <p className="mt-3 text-sm text-slate-400">
                      Run a live stress test to price this account.
                    </p>
                  </div>
                )}

                <Card title="Value at Risk (VaR)" subtitle="95% one-year loss from resampled market days">
                  <div className="mt-2">
                    <span className="text-3xl font-extrabold text-rose-400">
                      {historyResults ? `$${historyResults.var95.toLocaleString()}` : '—'}
                    </span>
                    <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                      {historyResults?.narrative ||
                        'Results use Yahoo Finance prices for the tickers in this portfolio, not a fixed shock.'}
                    </p>
                  </div>
                </Card>
              </div>

              <Card
                title="Asset Class Impact Analysis"
                subtitle="Immediate price impact of this scenario"
              >
                <div
                  className="grid grid-cols-1 gap-4 mt-2"
                >
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">Equities</span>
                    <p
                      className={`text-2xl font-bold mt-2 ${
                        (historyResults?.equityDrawdown ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {historyResults ? `${historyResults.equityDrawdown}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">Fixed Income</span>
                    <p
                      className={`text-2xl font-bold mt-2 ${
                        (historyResults?.bondImpact ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {historyResults ? `${historyResults.bondImpact}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">
                      Real Assets / Commodities
                    </span>
                    <p
                      className={`text-2xl font-bold mt-2 ${
                        (historyResults?.realAssetHedge ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {historyResults
                        ? `${historyResults.realAssetHedge > 0 ? '+' : ''}${historyResults.realAssetHedge}%`
                        : '—'}
                    </p>
                  </div>
                  {historyResults?.unclassifiedImpact != null && (
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                      <span className="text-xs uppercase font-semibold text-slate-400">Unclassified</span>
                      <p
                        className={`text-2xl font-bold mt-2 ${
                          historyResults.unclassifiedImpact < 0 ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {`${historyResults.unclassifiedImpact > 0 ? '+' : ''}${historyResults.unclassifiedImpact}%`}
                      </p>
                    </div>
                  )}
                </div>
                {historyResults?.fallbackLabel && (
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    Class fallback: {historyResults.fallbackLabel}.
                  </p>
                )}
                {historyResults?.fallbackNote && (
                  <p className="text-xs text-amber-200/90 mt-2 leading-relaxed">{historyResults.fallbackNote}</p>
                )}
              </Card>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4">
                <Card title="Starting value" subtitle="Latest Yahoo close for each traded holding">
                  <span className="text-2xl font-extrabold text-white">
                    {distributionResults ? money.format(distributionResults.startingValue) : '—'}
                  </span>
                </Card>
                <Card title="Median outcome (P50)" subtitle="Middle ending value of the paths">
                  <span className="text-2xl font-extrabold text-emerald-400">
                    {distributionResults ? money.format(distributionResults.p50) : '—'}
                  </span>
                </Card>
                <Card title="Value at Risk (VaR)" subtitle="95% loss from the live starting value">
                  <span className="text-2xl font-extrabold text-rose-400">
                    {distributionResults ? money.format(distributionResults.var95) : '—'}
                  </span>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
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
