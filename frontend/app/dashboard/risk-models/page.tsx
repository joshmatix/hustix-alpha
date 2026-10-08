'use client';

import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import MacroScenarioPicker from '@/components/dashboard/MacroScenarioPicker';
import RiskGauge from '@/components/dashboard/RiskGauge';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export default function RiskModelsPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState('rate_shock');
  const [isCalculating, setIsCalculating] = useState(false);
  const [simulationResults, setSimulationResults] = useState({
    overallScore: 68,
    equityDrawdown: -14.2,
    bondImpact: -6.8,
    realAssetHedge: +8.5,
    var95: 185000,
  });

  const handleRunSimulation = () => {
    setIsCalculating(true);
    // Simulating FastAPI macro risk engine calculation
    setTimeout(() => {
      const score = Math.floor(Math.random() * 30) + 55;
      setSimulationResults({
        overallScore: score,
        equityDrawdown: -(Math.random() * 10 + 10).toFixed(1) as unknown as number,
        bondImpact: -(Math.random() * 5 + 3).toFixed(1) as unknown as number,
        realAssetHedge: +(Math.random() * 8 + 2).toFixed(1) as unknown as number,
        var95: Math.floor(Math.random() * 100000) + 150000,
      });
      setIsCalculating(false);
    }, 1000);
  };

  return (
    <AuthGuard>
      <AppLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Macroeconomic Risk Modeling</h1>
            <p className="text-xs text-slate-400 mt-1">
              Configure global economic shock variables and simulate stress testing across asset classes.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Scenario Control */}
            <div className="space-y-6">
              <MacroScenarioPicker
                selectedScenarioId={selectedScenarioId}
                onSelectScenario={(sc) => setSelectedScenarioId(sc.id)}
                onRunSimulation={handleRunSimulation}
                isCalculating={isCalculating}
              />

              <Card title="Model Parameters" subtitle="Engine: FastAPI Monte Carlo / Factor Model">
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
                    <span className="text-slate-400">Factor Correlations</span>
                    <Badge variant="emerald">Dynamic (GARCH)</Badge>
                  </div>
                </div>
              </Card>
            </div>

            {/* Right 2 Columns: Stress Test Analytics & Impact Breakdown */}
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
                      Based on current scenario projections, there is a 5% probability that portfolio drawdown exceeds this threshold over the 12-month horizon.
                    </p>
                  </div>
                </Card>
              </div>

              {/* Asset Class Sensitivity Matrix */}
              <Card title="Asset Class Impact Analysis" subtitle="Projected percentage returns under current shock model">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">Equities</span>
                    <p className={`text-2xl font-bold mt-2 ${simulationResults.equityDrawdown < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {simulationResults.equityDrawdown}%
                    </p>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">Fixed Income</span>
                    <p className={`text-2xl font-bold mt-2 ${simulationResults.bondImpact < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {simulationResults.bondImpact}%
                    </p>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span className="text-xs uppercase font-semibold text-slate-400">Real Assets / Commodities</span>
                    <p className={`text-2xl font-bold mt-2 ${simulationResults.realAssetHedge > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      +{simulationResults.realAssetHedge}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </AppLayout>
    </AuthGuard>
  );
}