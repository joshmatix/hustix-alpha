'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AllocationPie from '@/components/dashboard/AllocationPie';
import MacroScenarioPicker from '@/components/dashboard/MacroScenarioPicker';
import RiskGauge from '@/components/dashboard/RiskGauge';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { apiFetch, type Portfolio } from '@/lib/api';

const SCENARIO_MAP: Record<string, string> = {
  rate_shock: 'Rate_Shock',
  stagflation: 'Stagflation',
  soft_landing: 'Soft_Landing',
};

function RiskModelsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portfolioId = searchParams.get('portfolio');
  const [selectedScenarioId, setSelectedScenarioId] = useState('rate_shock');
  const [isCalculating, setIsCalculating] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [simulationResults, setSimulationResults] = useState<{
    overallScore: number;
    equityDrawdown: number;
    bondImpact: number;
    realAssetHedge: number;
    var95: number;
    narrative: string;
  } | null>(null);

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
    setIsCalculating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/simulate', {
        method: 'POST',
        body: JSON.stringify({
          portfolio_id: portfolioId,
          scenario: SCENARIO_MAP[selectedScenarioId] || 'Rate_Shock',
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || 'Simulation failed.');
      }
      setSimulationResults({
        overallScore: Number(body.overall_score ?? 50),
        equityDrawdown: Number(body.asset_impacts?.Equities ?? 0),
        bondImpact: Number(body.asset_impacts?.Bonds ?? 0),
        realAssetHedge: Number(body.asset_impacts?.Real_Assets ?? 0),
        var95: Math.abs(Math.round(Number(body.var_95_loss ?? 0))),
        narrative: body.narrative || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the risk engine.');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!portfolioId) {
      setError('Choose a portfolio before downloading a report.');
      return;
    }
    const portfolioValue = Number(portfolio?.portfolio_value ?? 0);
    if (portfolioValue <= 0) {
      setError('Upload holdings before downloading a report. This account has no value yet.');
      return;
    }
    setIsReporting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/report', {
        method: 'POST',
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'Could not create the report.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (portfolio?.name || 'portfolio').replace(/[^\w.-]+/g, '-');
      link.href = url;
      link.download = `${safeName}-macro-stress-test.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the report.');
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-white">Macroeconomic Risk Modeling</h1>
          <Button variant="secondary" onClick={handleDownloadReport} isLoading={isReporting}>
            Download report
          </Button>
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
          <MacroScenarioPicker
            selectedScenarioId={selectedScenarioId}
            onSelectScenario={(sc) => setSelectedScenarioId(sc.id)}
            onRunSimulation={handleRunSimulation}
            isCalculating={isCalculating}
          />

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

          <AllocationPie allocation={portfolio?.asset_allocation ?? null} />
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {simulationResults ? (
              <RiskGauge
                score={simulationResults.overallScore}
                label="Portfolio Vulnerability Index"
                projectedLoss={simulationResults.var95}
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
                  {simulationResults ? `$${simulationResults.var95.toLocaleString()}` : '—'}
                </span>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {simulationResults?.narrative ||
                    'Results use Yahoo Finance prices for the tickers in this portfolio, not a fixed shock.'}
                </p>
              </div>
            </Card>
          </div>

          <Card
            title="Asset Class Impact Analysis"
            subtitle="Average 12-month return on the days that match this scenario"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">Equities</span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    (simulationResults?.equityDrawdown ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {simulationResults ? `${simulationResults.equityDrawdown}%` : '—'}
                </p>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">Fixed Income</span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    (simulationResults?.bondImpact ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {simulationResults ? `${simulationResults.bondImpact}%` : '—'}
                </p>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">
                  Real Assets / Commodities
                </span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    (simulationResults?.realAssetHedge ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {simulationResults
                    ? `${simulationResults.realAssetHedge > 0 ? '+' : ''}${simulationResults.realAssetHedge}%`
                    : '—'}
                </p>
              </div>
            </div>
          </Card>
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
