import { supabase } from '@/lib/supabaseClient';

function resolveApiBase() {
  // The browser always calls this site. Locally, Next proxies /api to
  // 127.0.0.1:8000. In production, Vercel sends /api to the FastAPI service.
  // Neither path is a public page calling a loopback address.
  if (typeof window !== 'undefined') return '';
  return process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
}

export const API_BASE = resolveApiBase();

export type AssetAllocation = {
  equities: number;
  bonds: number;
  realAssets: number;
  cash: number;
};

export type Portfolio = {
  id: string;
  name: string;
  description?: string;
  account_number?: string | null;
  sub_account_number?: string | null;
  tax_status?: string | null;
  portfolio_value: number;
  asset_allocation: AssetAllocation;
  target_risk_profile?: string;
  created_at?: string;
};

export type Holding = {
  holding_id: string;
  ticker: string;
  asset_name?: string;
  asset_class: string;
  quantity: number;
  current_price: number;
  market_value: number;
  duration_years: number;
  beta: number;
};

async function authHeaders(extra?: HeadersInit, json = true): Promise<Headers> {
  const headers = new Headers(extra);
  if (json && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return headers;
}

export async function apiFetch(path: string, init: RequestInit = {}, json = true) {
  const headers = await authHeaders(init.headers, json);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  return response;
}

export type PooledAllocation = {
  allocation: AssetAllocation;
  dollars: AssetAllocation;
  totalValue: number;
  count: number;
};

/** Dollar-weight each portfolio, then express every asset class as a share of the combined book. */
export function poolAssetAllocation(
  portfolios: Array<{ portfolio_value: number; asset_allocation?: AssetAllocation | null }>
): PooledAllocation {
  const dollars: AssetAllocation = { equities: 0, bonds: 0, realAssets: 0, cash: 0 };
  let totalValue = 0;

  for (const portfolio of portfolios) {
    const value = Math.max(0, Number(portfolio.portfolio_value) || 0);
    totalValue += value;
    const allocation = portfolio.asset_allocation;
    if (!allocation || value === 0) continue;
    dollars.equities += (value * Number(allocation.equities || 0)) / 100;
    dollars.bonds += (value * Number(allocation.bonds || 0)) / 100;
    dollars.realAssets += (value * Number(allocation.realAssets || 0)) / 100;
    dollars.cash += (value * Number(allocation.cash || 0)) / 100;
  }

  const share = (amount: number) => (totalValue > 0 ? (amount / totalValue) * 100 : 0);
  return {
    allocation: {
      equities: share(dollars.equities),
      bonds: share(dollars.bonds),
      realAssets: share(dollars.realAssets),
      cash: share(dollars.cash),
    },
    dollars,
    totalValue,
    count: portfolios.length,
  };
}

export function allocationToEngineWeights(allocation: AssetAllocation) {
  const total =
    allocation.equities + allocation.bonds + allocation.realAssets + allocation.cash || 1;
  return {
    Equities: allocation.equities / total,
    Bonds: allocation.bonds / total,
    Real_Assets: allocation.realAssets / total,
    Cash: allocation.cash / total,
  };
}
