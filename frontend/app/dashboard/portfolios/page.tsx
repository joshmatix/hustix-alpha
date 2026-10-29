'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CreatePortfolioModal from '@/components/CreatePortfolioModal';
import DeletePortfolioModal from '@/components/DeletePortfolioModal';
import Button from '@/components/ui/Button';
import { PortfolioListSkeleton, SkeletonFade } from '@/components/ui/Skeleton';
import { apiFetch, type Holding, type Portfolio } from '@/lib/api';
import { portfolioLimitSentence } from '@/lib/planLimits';
import { supabase } from '@/lib/supabaseClient';
import { createCheckoutSession } from '@/lib/stripeCheckout';
import { holdingsCsvFileError } from '@/lib/holdingsCsvLimits';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const PORTFOLIO_VIEW_KEY = 'hustix-portfolio-view';

function portfolioAccountLine(portfolio: Portfolio) {
  return [
    portfolio.account_number?.trim() ? `Client Master ID ${portfolio.account_number.trim()}` : '',
    portfolio.sub_account_number?.trim() ? `Sub-Account ${portfolio.sub_account_number.trim()}` : '',
  ].filter(Boolean).join(' · ');
}

type PortfolioView = 'cards' | 'list';

function PortfolioCsvActions({
  portfolioName,
  uploading,
  classificationMode,
  onFile,
}: {
  portfolioName: string;
  uploading: boolean;
  classificationMode: 'csv' | 'authoritative';
  onFile: (file: File) => void;
}) {
  return (
    <>
      <div className="group relative inline-flex">
        <label className="relative inline-flex rounded-lg focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2 focus-within:ring-offset-slate-950">
          <span className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 group-hover:bg-amber-500/25">
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </span>
          <input
            type="file"
            accept=".csv,.CSV,text/csv"
            aria-label={`Upload CSV for ${portfolioName}`}
            aria-describedby="csv-format-help"
            disabled={uploading}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed focus:outline-none"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
        </label>
        <div
          role="tooltip"
          aria-hidden="true"
          className="absolute bottom-full left-0 z-30 w-64 pb-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-left text-xs font-normal leading-relaxed text-slate-300 shadow-xl">
            <p className="font-semibold text-slate-100">CSV columns</p>
            <p className="mt-1">Column order is not significant.</p>
            <p className="mt-2 text-slate-400">Required</p>
            <p>
              ticker, quantity, current_price
              {classificationMode === 'csv' ? ', asset_class' : ''}
            </p>
            {classificationMode === 'authoritative' && (
              <p className="mt-2 text-amber-200/90">Asset class comes from Tiingo for this firm.</p>
            )}
            <p className="mt-2 text-slate-400">Optional</p>
            <p>asset_name, duration_years, beta</p>
            <p className="mt-2 text-slate-400">
              Quantity is the share count. Equity prices are replaced with the market-data close. Schwab, Fidelity, LPL, BNY Mellon, and Raymond James position exports are accepted. Uploading replaces the holdings already in this portfolio.
            </p>
            <a
              href="/samples/holdings-sample.csv"
              download="holdings-sample.csv"
              className="mt-2 inline-block font-semibold text-indigo-300 hover:text-indigo-200"
            >
              Download sample CSV
            </a>
            <Link
              href="/dashboard/help#holdings-csv"
              className="mt-1 block font-semibold text-indigo-300 hover:text-indigo-200"
            >
              Format guide
            </Link>
          </div>
        </div>
      </div>
      <a
        href="/samples/holdings-sample.csv"
        download="holdings-sample.csv"
        className="text-xs font-semibold text-indigo-300 hover:text-indigo-200"
      >
        Download sample CSV
      </a>
      <p className="text-xs font-medium text-amber-300">Replaces existing holdings</p>
    </>
  );
}

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
  const [portfolioToDelete, setPortfolioToDelete] = useState<Portfolio | null>(null);
  const [csvReplace, setCsvReplace] = useState<{
    portfolioId: string;
    portfolioName: string;
    file: File;
  } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [planLimits, setPlanLimits] = useState<{
    name: string;
    portfolioLimit: number | null;
    tickerLimit: number | null;
  } | null>(null);
  const [portfolioView, setPortfolioView] = useState<PortfolioView>('cards');
  const [accountFilter, setAccountFilter] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [holdingsClassSource, setHoldingsClassSource] = useState<'csv' | 'authoritative'>('csv');
  const [notice, setNotice] = useState<{
    message: string;
    detail: string;
    offerUpgrade?: boolean;
    upgradeTarget?: string;
    upgradeName?: string;
    file?: File;
    portfolioId?: string;
  } | null>(null);

  const applyQuote = (data: {
    plan_name?: string;
    portfolio_limit?: number | null;
    ticker_limit?: number | null;
  } | null) => {
    if (!data?.plan_name) return;
    setPlanLimits({
      name: data.plan_name,
      portfolioLimit: data.portfolio_limit ?? null,
      tickerLimit: data.ticker_limit ?? null,
    });
  };

  useEffect(() => {
    supabase.rpc('firm_subscription_quote').then(({ data }) => {
      applyQuote(data);
    });
  }, []);

  useEffect(() => {
    async function loadFirmClassSource() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('firm_members')
        .select('firm_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!membership?.firm_id) return;
      const { data: firm } = await supabase
        .from('firms')
        .select('holdings_classification_source')
        .eq('id', membership.firm_id)
        .maybeSingle();
      const source = String(firm?.holdings_classification_source || 'csv').toLowerCase();
      setHoldingsClassSource(source === 'authoritative' ? 'authoritative' : 'csv');
    }
    void loadFirmClassSource();
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(PORTFOLIO_VIEW_KEY);
    if (saved === 'list' || saved === 'cards') setPortfolioView(saved);
  }, []);

  const choosePortfolioView = (next: PortfolioView) => {
    setPortfolioView(next);
    window.localStorage.setItem(PORTFOLIO_VIEW_KEY, next);
  };

  const accountIds = Array.from(
    new Set(
      portfolios
        .map((portfolio) => (portfolio.account_number || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (!accountFilter) return;
    const stillThere = portfolios.some(
      (portfolio) => (portfolio.account_number || '').trim() === accountFilter
    );
    if (!stillThere) setAccountFilter('');
  }, [portfolios, accountFilter]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target)) setAccountMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountMenuOpen]);

  const chooseAccount = (accountId: string) => {
    setAccountFilter(accountId);
    setAccountMenuOpen(false);
  };

  const visiblePortfolios = portfolios.filter((portfolio) => {
    if (accountFilter && (portfolio.account_number || '').trim() !== accountFilter) return false;
    return true;
  });
  const emptyFilterMessage = 'No portfolios match that client.';

  if (selectedId && !visiblePortfolios.some((portfolio) => portfolio.id === selectedId)) {
    setSelectedId(null);
    setHoldings([]);
    setHoldingsLoading(false);
  }

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

  const handleCreatePortfolio = async (data: {
    name: string;
    description: string;
    accountNumber: string;
    subAccountNumber: string;
    file: File | null;
  }) => {
    const res = await apiFetch('/api/portfolios/create', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        account_number: data.accountNumber,
        sub_account_number: data.subAccountNumber,
        account_alias: data.name,
        target_risk_profile: 'Balanced',
        portfolio_value: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.detail || 'Could not create portfolio.';
      if (detail && typeof detail === 'object' && detail.upgrade_code) {
        setNotice({
          message: detail.message,
          detail: '',
          offerUpgrade: true,
          upgradeTarget: detail.upgrade_code,
          upgradeName: detail.upgrade_name,
        });
        return;
      }
      throw new Error(typeof detail === 'string' ? detail : detail.message || 'Could not create portfolio.');
    }
    setNotice(null);

    const created = await res.json().catch(() => ({}));
    const portfolioId = created.portfolio_id ? String(created.portfolio_id) : '';
    if (data.file && portfolioId) {
      const uploadError = await handleCsvUpload(portfolioId, data.file);
      if (uploadError) {
        await apiFetch(`/api/portfolios/${portfolioId}`, { method: 'DELETE' }).catch(() => undefined);
        await fetchPortfolios(true);
        throw new Error(uploadError);
      }
    }
    await fetchPortfolios(true);
  };

  const handleDeletePortfolio = async () => {
    if (!portfolioToDelete) return;
    const res = await apiFetch(`/api/portfolios/${portfolioToDelete.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Could not delete portfolio.');
    }
    if (selectedId === portfolioToDelete.id) {
      setSelectedId(null);
      setHoldings([]);
    }
    await fetchPortfolios(true);
  };

  const handleCsvUpload = async (portfolioId: string, file: File) => {
    const sizeError = holdingsCsvFileError(file);
    if (sizeError) {
      setError(sizeError);
      return sizeError;
    }
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = body.detail || 'CSV upload failed.';
        setError(message);
        return message;
      }
      if (body.status === 'upgrade_required') {
        const message = body.detail || body.message || 'This file has more tickers than the current plan allows.';
        setNotice({
          message: 'Holdings were not saved.',
          detail: [message, body.message].filter((part, index, parts) => part && parts.indexOf(part) === index).join(' '),
          offerUpgrade: Boolean(body.upgrade_code),
          upgradeTarget: body.upgrade_code,
          upgradeName: body.upgrade_name,
          file,
          portfolioId,
        });
        return message;
      }
      setNotice(null);
      await fetchPortfolios(true);
      await loadHoldings(portfolioId);
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSV upload failed.';
      setError(message);
      return message;
    } finally {
      setUploadingId(null);
    }
  };

  const upgradePlan = async () => {
    const pending = notice;
    const target = pending?.upgradeTarget || 'pro';
    setUpgrading(true);
    setError(null);
    if (target === 'pro' || target === 'pro_plus') {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setUpgrading(false);
        setError('Sign in again before changing the plan.');
        return;
      }
      const result = await createCheckoutSession(target, session.access_token);
      if ('error' in result) {
        setUpgrading(false);
        setNotice({
          message: pending?.message || `Upgrade to ${pending?.upgradeName || 'the next plan'}`,
          detail: result.error,
          offerUpgrade: true,
          upgradeTarget: target,
          upgradeName: pending?.upgradeName,
          file: pending?.file,
          portfolioId: pending?.portfolioId,
        });
        return;
      }
      window.location.assign(result.url);
      return;
    }
    const { data, error: upgradeError } = await supabase.rpc('set_firm_plan', { target });
    setUpgrading(false);
    if (upgradeError) {
      setNotice({
        message: pending?.message || `Upgrade to ${pending?.upgradeName || 'the next plan'}`,
        detail: upgradeError.message,
        offerUpgrade: true,
        upgradeTarget: target,
        upgradeName: pending?.upgradeName,
        file: pending?.file,
        portfolioId: pending?.portfolioId,
      });
      return;
    }
    applyQuote(data);
    setNotice(null);
    if (pending?.file && pending.portfolioId) {
      await handleCsvUpload(pending.portfolioId, pending.file);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolios</h1>
          <p className="mt-1 text-xs text-slate-400">
            Manage client portfolios and upload holdings for macro risk analysis.
            {planLimits ? ` ${portfolioLimitSentence(planLimits.name, planLimits.portfolioLimit, planLimits.tickerLimit)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {portfolios.length > 0 && (
            <div className="inline-flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Portfolio layout">
              <button
                type="button"
                aria-pressed={portfolioView === 'cards'}
                onClick={() => choosePortfolioView('cards')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  portfolioView === 'cards' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Cards
              </button>
              <button
                type="button"
                aria-pressed={portfolioView === 'list'}
                onClick={() => choosePortfolioView('list')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  portfolioView === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                List
              </button>
            </div>
          )}
          <Button onClick={() => setIsModalOpen(true)}>+ Create Portfolio</Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">Data Privacy &amp; Processing Notice:</p>
        <p className="mt-1">
          Portfolio files are parsed in temporary memory during your session to generate analytical metrics and are immediately discarded upon request completion. Files are neither saved, stored, nor archived on our servers or databases.
        </p>
      </div>

      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-4">
          <div>
            <p className="text-sm font-medium text-white">{notice.message}</p>
            {notice.detail && <p className="mt-1 text-xs text-slate-300">{notice.detail}</p>}
          </div>
          {notice.offerUpgrade !== false && (
            <Button isLoading={upgrading} onClick={() => void upgradePlan()}>
              {notice.upgradeName ? `Upgrade to ${notice.upgradeName}` : 'Upgrade'}
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <SkeletonFade loading={isLoading} skeleton={<PortfolioListSkeleton />}>
        {portfolios.length === 0 ? (
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
        <>
        {holdingsClassSource === 'authoritative' && (
          <p className="mb-3 text-sm text-amber-200/90">
            This firm uses Tiingo for asset class on CSV upload. You do not need an asset_class column in the file.
          </p>
        )}
        <p id="csv-format-help" className="sr-only">
          Column order is not significant. Required columns: ticker, quantity, and current_price.
          {holdingsClassSource === 'csv'
            ? ' asset_class is required for this firm.'
            : ' Asset class is supplied by Tiingo for this firm.'}
          Quantity is the number of shares. Optional columns: asset_name, duration_years, and beta.
          A positions export from Schwab, Fidelity, LPL, BNY Mellon, or Raymond James is also accepted.
          A sample file is at /samples/holdings-sample.csv. Uploading replaces the holdings already in this portfolio.
        </p>
        <div className="flex flex-wrap gap-2">
        <div ref={accountMenuRef} className="relative w-full max-w-xs">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm focus:border-indigo-500 focus:outline-none"
          >
            <span className={accountFilter ? 'text-slate-100' : 'text-slate-400'}>
              {accountFilter || 'All clients'}
            </span>
            <span aria-hidden="true" className="text-slate-500">▾</span>
          </button>
          {accountMenuOpen && (
            <ul
              role="listbox"
              aria-label="Client Master IDs"
              className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-700 bg-slate-950 py-1 shadow-lg"
            >
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!accountFilter}
                  onClick={() => chooseAccount('')}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    accountFilter ? 'text-slate-300 hover:bg-slate-800' : 'bg-slate-800 text-white'
                  }`}
                >
                  All clients
                </button>
              </li>
              {accountIds.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">No Client Master IDs yet.</li>
              ) : (
                accountIds.map((accountId) => (
                  <li key={accountId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={accountFilter === accountId}
                      onClick={() => chooseAccount(accountId)}
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        accountFilter === accountId
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {accountId}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        </div>
        {visiblePortfolios.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
            {emptyFilterMessage}
          </p>
        ) : (
        <div className={portfolioView === 'cards' ? 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3' : 'divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900'}>
          {visiblePortfolios.map((portfolio) => portfolioView === 'cards' ? (
            <div
              key={portfolio.id}
              className="relative rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm hover:z-20 focus-within:z-20"
            >
              <h3 className="text-lg font-semibold text-white">{portfolio.name}</h3>
              {portfolioAccountLine(portfolio) && (
                <p className="mt-1 text-xs text-slate-500">{portfolioAccountLine(portfolio)}</p>
              )}
              <p className="mt-2 text-sm text-slate-400">
                {portfolio.description || 'No description provided.'}
              </p>
              <p className="mt-4 text-emerald-400 font-semibold">
                ${Number(portfolio.portfolio_value || 0).toLocaleString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={selectedId === portfolio.id}
                  onClick={() => loadHoldings(portfolio.id)}
                >
                  View holdings
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push(`/dashboard/risk-models?portfolio=${portfolio.id}`)}
                >
                  Analyze Risk
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <PortfolioCsvActions
                  portfolioName={portfolio.name}
                  uploading={uploadingId === portfolio.id}
                  classificationMode={holdingsClassSource}
                  onFile={(file) =>
                    setCsvReplace({
                      portfolioId: portfolio.id,
                      portfolioName: portfolio.name,
                      file,
                    })
                  }
                />
              </div>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setPortfolioToDelete(portfolio)}
                  className="text-xs font-semibold text-rose-400 hover:text-rose-300"
                >
                  Delete portfolio
                </button>
              </div>
            </div>
          ) : (
            <div key={portfolio.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{portfolio.name}</p>
                {portfolioAccountLine(portfolio) && (
                  <p className="truncate text-xs text-slate-500">{portfolioAccountLine(portfolio)}</p>
                )}
                <p className="truncate text-xs text-slate-400">
                  {portfolio.description || 'No description provided.'}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-emerald-400">
                ${Number(portfolio.portfolio_value || 0).toLocaleString()}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={selectedId === portfolio.id}
                  onClick={() => loadHoldings(portfolio.id)}
                >
                  View holdings
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push(`/dashboard/risk-models?portfolio=${portfolio.id}`)}
                >
                  Analyze Risk
                </Button>
                <PortfolioCsvActions
                  portfolioName={portfolio.name}
                  uploading={uploadingId === portfolio.id}
                  classificationMode={holdingsClassSource}
                  onFile={(file) =>
                    setCsvReplace({
                      portfolioId: portfolio.id,
                      portfolioName: portfolio.name,
                      file,
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() => setPortfolioToDelete(portfolio)}
                  className="text-xs font-semibold text-rose-400 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        )}
        </>
        )}
      </SkeletonFade>

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
      <DeletePortfolioModal
        portfolioName={portfolioToDelete?.name ?? null}
        onClose={() => setPortfolioToDelete(null)}
        onConfirm={handleDeletePortfolio}
      />
      <ReplaceHoldingsDialog
        pending={csvReplace}
        onAbort={() => setCsvReplace(null)}
        onConfirm={async () => {
          if (!csvReplace) return;
          const pending = csvReplace;
          setCsvReplace(null);
          await handleCsvUpload(pending.portfolioId, pending.file);
        }}
      />
    </div>
  );
}

function ReplaceHoldingsDialog({
  pending,
  onAbort,
  onConfirm,
}: {
  pending: { portfolioName: string; file: File } | null;
  onAbort: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onAbort();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, onAbort]);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="replace-holdings-title"
        aria-describedby="replace-holdings-warning"
        className="w-full max-w-md rounded-lg border border-amber-500/40 bg-slate-900 p-6 shadow-xl"
      >
        <h2 id="replace-holdings-title" className="text-xl font-semibold text-white">
          Replace holdings?
        </h2>
        <p id="replace-holdings-warning" className="mt-3 text-sm text-slate-300">
          <span className="font-semibold text-white">{pending.file.name}</span> will replace every
          holding in <span className="font-semibold text-white">{pending.portfolioName}</span>.
          The current holdings will be removed.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" autoFocus onClick={onAbort}>
            Abort
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Replace holdings
          </Button>
        </div>
      </div>
    </div>
  );
}
