'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '📊' },
  { name: 'Portfolios', href: '/dashboard/portfolios', icon: '💼' },
  { name: 'Macro Risk Models', href: '/dashboard/risk-models', icon: '📈' },
  { name: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (!cancelled) setEngineOnline(res.ok);
      })
      .catch(() => {
        if (!cancelled) setEngineOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 min-h-screen flex flex-col justify-between p-4">
      <div>
        <div className="flex items-center gap-3 px-3 py-4 border-b border-slate-800 mb-6">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-lg">
            M
          </div>
          <div>
            <h1 className="font-bold text-white text-base leading-none">MacroRisk AI</h1>
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              Advisor Suite
            </span>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-xs text-slate-400">
        <p className="font-semibold text-slate-300">FastAPI Status</p>
        <p
          className={`flex items-center gap-1.5 text-[11px] mt-1 ${
            engineOnline === false ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              engineOnline === false ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'
            }`}
          />
          {engineOnline === null
            ? 'Checking engine...'
            : engineOnline
              ? 'Engine Connected'
              : 'Engine Offline'}
        </p>
      </div>
    </aside>
  );
}
