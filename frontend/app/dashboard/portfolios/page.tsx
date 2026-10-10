'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreatePortfolioModal from '@/components/CreatePortfolioModal';
import Button from '@/components/ui/Button';
import { apiFetch, type Holding, type Portfolio } from '@/lib/api';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function PortfoliosPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  const fetchPortfolios = async (quiet = false) => {
    try {
      if (!quiet) setIsLoading(true);
      setError(null);
      const res = await apiFetch('/api/portfolios');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed to fetch portfolios (${res.status})`);
      }
      setPortfolios(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch portfolios.');
    } finally {
      if (!quiet) setIsLoading(false);
    }
  };

  const loadHoldings = async (portfolioId: string) => {
    setSelectedId(portfolioId);
    setHoldingsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/portfolios/${portfolioId}/holdings`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'Could not load holdings.');
      }
      setHoldings(await res.json());
    } catch (err) {
      setHoldings([]);
      setError(err instanceof Error ? err.message : 'Could not load holdings.');
    } finally {
      setHoldingsLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolios();
  }, []);

  const handleCreatePortfolio = async (data: { name: string; description: string }) => {
    const res = await apiFetch('/api/portfolios/create', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        account_alias: data.name,
        target_risk_profile: 'Balanced',
        portfolio_value: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Could not create portfolio.');
    }

    await fetchPortfolios();
  };

  const handleCsvUpload = async (portfolioId: string, file: File) => {
    setUploadingId(portfolioId);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(
        `/api/portfolios/${portfolioId}/upload-csv`,
        { method: 'POST', body: form },
        false
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'CSV upload failed.');
      }
      await fetchPortfolios(true);
      await loadHoldings(portfolioId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV upload failed.');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolios</h1>
          <p className="mt-1 text-xs text-slate-400">
            Manage client portfolios and upload holdings for macro risk analysis.
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>+ Create Portfolio</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-slate-400">Loading portfolios...</div>
      ) : portfolios.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-700 p-12 text-center">
          <h3 className="text-lg font-medium text-white">No portfolios available</h3>
          <p className="mt-1 text-sm text-slate-400">
            Create a new portfolio to get started with stress testing.
          </p>
          <div className="mt-6">
            <Button onClick={() => setIsModalOpen(true)}>+ Create Portfolio</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((portfolio) => (
            <div
              key={portfolio.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-white">{portfolio.name}</h3>
              <p className="mt-2 text-sm text-slate-400">
                {portfolio.description || 'No description provided.'}
              </p>
              <p className="mt-4 text-emerald-400 font-semibold">
                ${Number(portfolio.portfolio_value || 0).toLocaleString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => loadHoldings(portfolio.id)}>
                  {selectedId === portfolio.id ? 'Holdings' : 'View holdings'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push(`/dashboard/risk-models?portfolio=${portfolio.id}`)}
                >
                  Analyze Risk
                </Button>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvUpload(portfolio.id, file);
                      e.target.value = '';
                    }}
                  />
                  <span className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer">
                    {uploadingId === portfolio.id ? 'Uploading...' : 'Upload CSV'}
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-bold text-white text-base">
              {portfolios.find((p) => p.id === selectedId)?.name || 'Portfolio'} holdings
            </h2>
          </div>
          {holdingsLoading ? (
            <p className="px-6 py-8 text-sm text-slate-400">Loading holdings...</p>
          ) : holdings.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-400">
              No holdings yet. Upload a CSV to fill this portfolio.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/50 text-xs uppercase text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3.5">Ticker</th>
                    <th className="px-6 py-3.5">Name</th>
                    <th className="px-6 py-3.5">Class</th>
                    <th className="px-6 py-3.5 text-right">Quantity</th>
                    <th className="px-6 py-3.5 text-right">Price</th>
                    <th className="px-6 py-3.5 text-right">Market value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {holdings.map((holding) => (
                    <tr key={holding.holding_id} className="hover:bg-slate-800/40">
                      <td className="px-6 py-4 font-medium text-white">{holding.ticker}</td>
                      <td className="px-6 py-4">{holding.asset_name || holding.ticker}</td>
                      <td className="px-6 py-4">{holding.asset_class}</td>
                      <td className="px-6 py-4 text-right">{holding.quantity.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">{money.format(holding.current_price)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-emerald-400">
                        {money.format(holding.market_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <CreatePortfolioModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreatePortfolio}
      />
    </div>
  );
}
