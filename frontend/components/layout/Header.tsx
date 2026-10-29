'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { API_BASE } from '@/lib/api';
import { formatDurationMs, readSessionTiming } from '@/lib/sessionIdle';
import VersionAlert from './VersionAlert';

type MoveUnit = 'bps' | 'pct';

type Ticker = {
  label: string;
  value: string;
  change: number | null;
  unit: MoveUnit;
  hint?: string;
};

const navItems = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Portfolios', href: '/dashboard/portfolios' },
  { name: 'Risk Models', href: '/dashboard/risk-models' },
  { name: 'Settings', href: '/dashboard/settings' },
  { name: 'Help', href: '/dashboard/help' },
];

const placeholderTickers: Ticker[] = [
  { label: 'Fed Funds (EFFR)', value: '—', change: null, unit: 'bps' },
  { label: 'US 10Y (TNX)', value: '—', change: null, unit: 'bps' },
  { label: 'USD Proxy', value: '—', change: null, unit: 'pct', hint: 'Synthetic USD Index (Calculated via UUP)' },
  { label: 'Bitcoin (BTC)', value: '—', change: null, unit: 'pct' },
];

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

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
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

function TickerChip({ ticker }: { ticker: Ticker }) {
  return (
    <div
      title={ticker.hint}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px]"
    >
      <span className="text-slate-400">{ticker.label}</span>
      <span className="font-semibold text-indigo-300">{ticker.value}</span>
      <TrendBadge change={ticker.change} unit={ticker.unit} />
    </div>
  );
}

function BrandMark() {
  return (
    <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
        H
      </span>
      <span className="leading-none">
        <span className="block whitespace-nowrap text-sm font-bold text-white">Hustix Macro</span>
        <span className="mt-1 hidden text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:block">
          Advisor Suite
        </span>
      </span>
    </Link>
  );
}

function SessionBadge() {
  const [timing, setTiming] = useState(() => readSessionTiming());

  useEffect(() => {
    const tick = () => setTiming(readSessionTiming());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const warn = timing.warn;
  const label = warn
    ? `${formatDurationMs(timing.remainingMs)} left`
    : `Active ${formatDurationMs(timing.activeMs)}`;

  return (
    <div
      className={`shrink-0 rounded-lg border px-2.5 py-1 ${
        warn ? 'border-amber-800/80 bg-amber-950/40 text-right' : 'border-slate-800 bg-slate-950/70 text-left'
      }`}
      title={warn ? 'Sign out after 15 minutes of inactivity' : 'Time since this sign-in'}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">Advisor Suite</p>
      <p
        className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${
          warn ? 'justify-end text-amber-400' : 'justify-start text-emerald-400'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            warn ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500 animate-pulse'
          }`}
        />
        {label}
      </p>
    </div>
  );
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tickers, setTickers] = useState<Ticker[]>(placeholderTickers);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
        if (!indicators) {
          setTickers(placeholderTickers);
          return;
        }
        setTickers([
          {
            label: 'Fed Funds (EFFR)',
            value: indicators.Fed_Funds_Rate == null ? '—' : `${Number(indicators.Fed_Funds_Rate).toFixed(2)}%`,
            change: indicators.Fed_Funds_Rate_change == null ? null : Number(indicators.Fed_Funds_Rate_change),
            unit: 'bps',
          },
          {
            label: 'US 10Y (TNX)',
            value: indicators['10Y_Yield'] == null ? '—' : `${Number(indicators['10Y_Yield']).toFixed(2)}%`,
            change: indicators['10Y_Yield_change'] == null ? null : Number(indicators['10Y_Yield_change']),
            unit: 'bps',
          },
          {
            label: 'USD Proxy',
            hint: 'Synthetic USD Index (Calculated via UUP)',
            value: indicators.Dollar_Index == null ? '—' : Number(indicators.Dollar_Index).toFixed(2),
            change: indicators.Dollar_Index_change_pct == null ? null : Number(indicators.Dollar_Index_change_pct),
            unit: 'pct',
          },
          {
            label: 'Bitcoin (BTC)',
            value: indicators.Bitcoin == null ? '—' : formatBitcoin(Number(indicators.Bitcoin)),
            change: indicators.Bitcoin_change_pct == null ? null : Number(indicators.Bitcoin_change_pct),
            unit: 'pct',
          },
        ]);
      })
      .catch(() => {
        setTickers(placeholderTickers);
      });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-200 md:hidden"
          aria-expanded={menuOpen}
          aria-controls="dashboard-nav-drawer"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="sr-only">{menuOpen ? 'Close navigation' : 'Open navigation'}</span>
          {menuOpen ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>

        <BrandMark />

        <nav className="hidden shrink-0 items-stretch self-stretch md:flex" aria-label="Dashboard">
          {navItems.map((item) => {
            const isActive = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative inline-flex items-center whitespace-nowrap px-3 text-sm font-medium transition ${
                  isActive ? 'text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.name}
                <span
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full ${
                    isActive ? 'bg-indigo-400' : 'bg-transparent'
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <VersionAlert />
          {userEmail && (
            <span className="hidden max-w-[12rem] truncate rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 lg:inline">
              {userEmail}
            </span>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="hidden rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 sm:inline"
          >
            Sign Out
          </button>
          <SessionBadge />
        </div>
      </div>

      <div className="overflow-x-auto px-3 pb-2.5 sm:px-5">
        <div className="ml-auto flex w-max min-w-full justify-end gap-2">
          {tickers.map((ticker) => (
            <TickerChip key={ticker.label} ticker={ticker} />
          ))}
        </div>
      </div>

      {menuOpen && (
        <nav
          id="dashboard-nav-drawer"
          className="border-t border-slate-800 px-3 py-2 md:hidden"
          aria-label="Dashboard"
        >
          {navItems.map((item) => {
            const isActive = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center border-l-2 px-3 py-2.5 text-sm font-medium ${
                  isActive
                    ? 'border-indigo-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-1 w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-sm font-medium text-slate-300 sm:hidden"
          >
            Sign Out
          </button>
        </nav>
      )}
    </header>
  );
}
