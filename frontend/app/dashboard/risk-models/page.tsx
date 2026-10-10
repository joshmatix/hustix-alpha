'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import MacroScenarioPicker from '@/components/dashboard/MacroScenarioPicker';
import RiskGauge from '@/components/dashboard/RiskGauge';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import {
  apiFetch,
  allocationToEngineWeights,
  type Portfolio,
} from '@/lib/api';

const SCENARIO_MAP: Record<string, string> = {
  rate_shock: 'Rate_Shock',
  stagflation: 'Stagflation',
  soft_landing: 'Soft_Landing',
};

function RiskModelsPage() {
  const searchParams = useSearchParams();
  const portfolioId = searchParams.get('portfolio');
  const [selectedScenarioId, setSelectedScenarioId] = useState('rate_shock');
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [simulationResults, setSimulationResults] = useState({
    overallScore: 68,
    equityDrawdown: -5.0,
    bondImpact: -8.0,
    realAssetHedge: 0.0,
    var95: 185000,
    narrative: 'Run a simulation to generate advisor commentary from the FastAPI engine.',
  });

  useEffect(() => {
    if (!portfolioId) return;
    apiFetch(`/api/portfolios/${portfolioId}`)
      .then(async (res) => {
        if (!res.ok) return;
        setPortfolio(await res.json());
      })
      .catch(() => undefined);
  }, [portfolioId]);

  const engineWeights = useMemo(() => {
    if (portfolio?.asset_allocation) {
      return allocationToEngineWeights(portfolio.asset_allocation);
    }
    return { Equities: 0.6, Bonds: 0.25, Real_Assets: 0.1, Cash: 0.05 };
  }, [portfolio]);

  const handleRunSimulation = async () => {
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
          portfolio_value: portfolioValue,
          weights: engineWeights,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Macroeconomic Risk Modeling</h1>
        <p className="text-xs text-slate-400 mt-1">
          {portfolio
            ? `Stress testing ${portfolio.name} ($${Number(portfolio.portfolio_value).toLocaleString()}).`
            : 'Configure a shock scenario and simulate across asset classes using the FastAPI Monte Carlo engine.'}
        </p>
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

          <Card title="Model Parameters" subtitle="Engine: FastAPI Monte Carlo">
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
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RiskGauge
              score={simulationResults.overallScore}
              label="Portfolio Vulnerability Index"
              projectedLoss={simulationResults.var95}
            />

            <Card title="Value at Risk (VaR)" subtitle="Estimated maximum loss at 95% confidence">
              <div className="mt-2">
                <span className="text-3xl font-extrabold text-rose-400">
                  ${simulationResults.var95.toLocaleString()}
                </span>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {simulationResults.narrative}
                </p>
              </div>
            </Card>
          </div>

          <Card
            title="Asset Class Impact Analysis"
            subtitle="Projected percentage returns under the selected shock"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">Equities</span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    simulationResults.equityDrawdown < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {simulationResults.equityDrawdown}%
                </p>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">Fixed Income</span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    simulationResults.bondImpact < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {simulationResults.bondImpact}%
                </p>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <span className="text-xs uppercase font-semibold text-slate-400">
                  Real Assets / Commodities
                </span>
                <p
                  className={`text-2xl font-bold mt-2 ${
                    simulationResults.realAssetHedge > 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {simulationResults.realAssetHedge > 0 ? '+' : ''}
                  {simulationResults.realAssetHedge}%
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
