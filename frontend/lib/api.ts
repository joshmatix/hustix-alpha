import { supabase } from '@/lib/supabaseClient';

export const API_BASE =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

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
