'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { API_BASE } from '@/lib/api';

type MoveUnit = 'bps' | 'pct';

type Ticker = {
  label: string;
  value: string;
  change: number | null;
  unit: MoveUnit;
};

const fallbackTickers: Ticker[] = [
  { label: 'Fed Funds (EFFR)', value: '5.25%', change: -0.01, unit: 'bps' },
  { label: 'US 10Y (TNX)', value: '4.22%', change: 0.02, unit: 'bps' },
  { label: 'USD Index (DXY)', value: '104.20', change: 0.12, unit: 'pct' },
  { label: 'Bitcoin (BTC)', value: '$67,420', change: -0.05, unit: 'pct' },
];

const tickerCell: Record<string, string> = {
  'Fed Funds (EFFR)': 'col-start-1 row-start-1',
  'US 10Y (TNX)': 'col-start-2 row-start-1',
  'USD Index (DXY)': 'col-start-1 row-start-2',
  'Bitcoin (BTC)': 'col-start-2 row-start-2',
};

function formatMove(change: number, unit: MoveUnit) {
  if (unit === 'bps') {
    const bps = Math.round(change * 1000) / 10;
    const shown = Number.isInteger(bps) ? bps.toFixed(0) : bps.toFixed(1);
    return `${bps > 0 ? '+' : ''}${shown} bps`;
  }
  const pct = Math.round(change * 100) / 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatBitcoin(price: number) {
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function TrendBadge({ change, unit }: { change: number | null; unit: MoveUnit }) {
  if (change == null || Number.isNaN(change)) return null;
  const tone =
    change > 0
      ? 'bg-emerald-950/50 text-emerald-400'
      : change < 0
        ? 'bg-rose-950/50 text-rose-400'
        : 'bg-slate-800/50 text-slate-400';
  return <span className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>{formatMove(change, unit)}</span>;
}

export default function Header() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tickers, setTickers] = useState<Ticker[]>(fallbackTickers);

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    getUser();

    fetch(`${API_BASE}/api/macro/indicators`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const indicators = payload?.indicators;
        if (!indicators) return;
        const next: Ticker[] = [];
        if (indicators.Fed_Funds_Rate != null) {
          next.push({
            label: 'Fed Funds (EFFR)',
            value: `${Number(indicators.Fed_Funds_Rate).toFixed(2)}%`,
            change: indicators.Fed_Funds_Rate_change == null ? null : Number(indicators.Fed_Funds_Rate_change),
            unit: 'bps',
          });
        }
        if (indicators['10Y_Yield'] != null) {
          next.push({
            label: 'US 10Y (TNX)',
            value: `${Number(indicators['10Y_Yield']).toFixed(2)}%`,
            change: indicators['10Y_Yield_change'] == null ? null : Number(indicators['10Y_Yield_change']),
            unit: 'bps',
          });
        }
        if (indicators.Dollar_Index != null) {
          next.push({
            label: 'USD Index (DXY)',
            value: Number(indicators.Dollar_Index).toFixed(2),
            change: indicators.Dollar_Index_change_pct == null ? null : Number(indicators.Dollar_Index_change_pct),
            unit: 'pct',
          });
        }
        if (indicators.Bitcoin != null) {
          next.push({
            label: 'Bitcoin (BTC)',
            value: formatBitcoin(Number(indicators.Bitcoin)),
            change: indicators.Bitcoin_change_pct == null ? null : Number(indicators.Bitcoin_change_pct),
            unit: 'pct',
          });
        }
        if (next.length) setTickers(next);
      })
      .catch(() => {
        /* keep fallback ticker values */
      });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/50 px-6 py-2.5 backdrop-blur-md">
      <div className="grid w-max grid-cols-[max-content_max-content] grid-rows-2 gap-2 text-xs">
        {tickers.map((ticker) => (
          <div
            key={ticker.label}
            className={`flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 ${tickerCell[ticker.label] ?? ''}`}
          >
            <span className="text-slate-400">{ticker.label}:</span>
            <span className="font-semibold text-indigo-400">{ticker.value}</span>
            <TrendBadge change={ticker.change} unit={ticker.unit} />
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {userEmail && (
          <span className="text-xs text-slate-300 font-medium bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
            {userEmail}
          </span>
        )}
        <button
          onClick={handleSignOut}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-800 px-3 py-1.5 rounded-lg font-medium transition"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
