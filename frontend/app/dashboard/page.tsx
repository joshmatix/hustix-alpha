'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortfolioTable from '@/components/dashboard/PortfolioTable';
import AssetAllocationChart from '@/components/dashboard/AssetAllocationChart';
import RiskGauge from '@/components/dashboard/RiskGauge';
import { apiFetch, type Portfolio } from '@/lib/api';

const emptyAllocation = { equities: 0, bonds: 0, realAssets: 0, cash: 0 };

export default function DashboardPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch('/api/portfolios');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Could not load portfolios (${res.status})`);
        }
        const data: Portfolio[] = await res.json();
        setPortfolios(data);
        setSelectedId(data[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const selected = useMemo(
    () => portfolios.find((p) => p.id === selectedId) || portfolios[0],
    [portfolios, selectedId]
  );

  const tableRows = portfolios.map((p) => ({
    id: p.id,
    client_name: p.name,
    portfolio_value: Number(p.portfolio_value || 0),
    asset_allocation: p.asset_allocation || emptyAllocation,
    created_at: p.created_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio Macro Risk Overview</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review client books, allocation mix, and jump into scenario stress tests.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error} Start the FastAPI backend on port 8000 and confirm local Supabase is running.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading book of business...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PortfolioTable
              portfolios={tableRows}
              onSelectPortfolio={(row) => {
                setSelectedId(row.id);
                router.push(`/dashboard/risk-models?portfolio=${row.id}`);
              }}
            />
          </div>
          <div className="space-y-4">
            <RiskGauge
              score={selected ? Math.min(100, Math.round(Number(selected.portfolio_value) / 25000)) : 0}
              label="Book Concentration Proxy"
              projectedLoss={selected ? Math.round(Number(selected.portfolio_value) * 0.08) : 0}
            />
            <AssetAllocationChart allocation={selected?.asset_allocation || emptyAllocation} />
          </div>
        </div>
      )}
    </div>
  );
}
