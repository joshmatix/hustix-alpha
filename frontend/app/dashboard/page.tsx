'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortfolioTable from '@/components/dashboard/PortfolioTable';
import AssetAllocationChart from '@/components/dashboard/AssetAllocationChart';
import ClientAccountSelect, {
  clientAccountKey,
  clientAccountLabel,
} from '@/components/dashboard/ClientAccountSelect';
import RiskGauge from '@/components/dashboard/RiskGauge';
import { DashboardSkeleton, SkeletonFade } from '@/components/ui/Skeleton';
import { apiFetch, poolAssetAllocation, type Portfolio } from '@/lib/api';

const emptyAllocation = { equities: 0, bonds: 0, realAssets: 0, cash: 0 };

export default function DashboardPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(new Set());
  const [excludedPortfolios, setExcludedPortfolios] = useState<Set<string>>(new Set());
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const accounts = useMemo(() => {
    const ids = new Set(portfolios.map((portfolio) => clientAccountKey(portfolio.account_number)));
    return Array.from(ids)
      .sort((left, right) => {
        if (!left) return 1;
        if (!right) return -1;
        return left.localeCompare(right);
      })
      .map((id) => ({ id, label: clientAccountLabel(id) }));
  }, [portfolios]);

  const visiblePortfolios = useMemo(
    () => portfolios.filter((portfolio) => !excludedAccounts.has(clientAccountKey(portfolio.account_number))),
    [portfolios, excludedAccounts]
  );

  const pooledPortfolios = useMemo(
    () => visiblePortfolios.filter((portfolio) => !excludedPortfolios.has(portfolio.id)),
    [visiblePortfolios, excludedPortfolios]
  );

  const pooled = useMemo(
    () => poolAssetAllocation(pooledPortfolios),
    [pooledPortfolios]
  );

  const tableRows = visiblePortfolios.map((portfolio) => ({
    id: portfolio.id,
    client_name: portfolio.name,
    account_number: portfolio.account_number,
    sub_account_number: portfolio.sub_account_number,
    portfolio_value: Number(portfolio.portfolio_value || 0),
    asset_allocation: portfolio.asset_allocation || emptyAllocation,
    created_at: portfolio.created_at,
    selected: !excludedPortfolios.has(portfolio.id),
  }));

  const toggleAccount = (accountId: string) => {
    setExcludedAccounts((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const toggleAllAccounts = () => {
    setExcludedAccounts((current) => {
      const allSelected = accounts.length === 0 || accounts.every((account) => !current.has(account.id));
      if (allSelected) return new Set(accounts.map((account) => account.id));
      return new Set();
    });
  };

  const togglePortfolio = (portfolioId: string) => {
    setExcludedPortfolios((current) => {
      const next = new Set(current);
      if (next.has(portfolioId)) next.delete(portfolioId);
      else next.add(portfolioId);
      return next;
    });
  };

  const toggleVisiblePortfolios = (selected: boolean) => {
    setExcludedPortfolios((current) => {
      const next = new Set(current);
      for (const portfolio of visiblePortfolios) {
        if (selected) next.delete(portfolio.id);
        else next.add(portfolio.id);
      }
      return next;
    });
  };

  const emptyMessage = portfolios.length === 0
    ? 'Add a client portfolio to begin stress testing.'
    : 'No portfolios match the selected clients.';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio Macro Risk Overview</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review client portfolios, allocation mix, and jump into scenario stress tests.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error} Start the FastAPI backend on port 8000 and confirm local Supabase is running.
        </div>
      )}

      <SkeletonFade loading={loading} skeleton={<DashboardSkeleton />}>
        <div className="space-y-4">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="client-filter">
              Client
            </label>
            <ClientAccountSelect
              id="client-filter"
              accounts={accounts}
              excludedIds={excludedAccounts}
              onToggle={toggleAccount}
              onToggleAll={toggleAllAccounts}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PortfolioTable
                portfolios={tableRows}
                emptyMessage={emptyMessage}
                onTogglePortfolio={togglePortfolio}
                onToggleAll={toggleVisiblePortfolios}
                onSelectPortfolio={(row) => {
                  router.push(`/dashboard/risk-models?portfolio=${row.id}`);
                }}
              />
            </div>
            <div className="space-y-4">
              <RiskGauge
                score={pooled.totalValue > 0 ? Math.min(100, Math.round(pooled.totalValue / 25000)) : 0}
                label="Portfolio Concentration Proxy"
                projectedLoss={pooled.totalValue > 0 ? Math.round(pooled.totalValue * 0.08) : 0}
              />
              <AssetAllocationChart
                allocation={pooled.allocation}
                dollars={pooled.dollars}
                totalValue={pooled.totalValue}
                selectedCount={pooled.count}
                availableCount={portfolios.length}
              />
            </div>
          </div>
        </div>
      </SkeletonFade>
    </div>
  );
}
