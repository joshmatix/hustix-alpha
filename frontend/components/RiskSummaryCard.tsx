// components/RiskSummaryCard.tsx
import React from 'react';

interface RiskCardProps {
  scenarioName: string;
  shockedValue: number;
  var95Loss: number;
  narrative: string;
}

export const RiskSummaryCard: React.FC<RiskCardProps> = ({
  scenarioName,
  shockedValue,
  var95Loss,
  narrative
}) => {
  return (
    <div className="p-6 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-lg">
      <h3 className="text-xl font-bold text-indigo-400">{scenarioName} Analysis</h3>
      
      <div className="grid grid-cols-2 gap-4 my-4">
        <div className="bg-slate-800 p-3 rounded-lg">
          <p className="text-xs text-slate-400">Projected Portfolio Value</p>
          <p className="text-2xl font-semibold">${shockedValue.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 p-3 rounded-lg">
          <p className="text-xs text-slate-400">95% VaR Downside Risk</p>
          <p className="text-2xl font-semibold text-rose-400">-${var95Loss.toLocaleString()}</p>
        </div>
      </div>

      <p className="text-sm text-slate-300 bg-slate-800/50 p-3 rounded border border-slate-700/50">
        {narrative}
      </p>
    </div>
  );
};