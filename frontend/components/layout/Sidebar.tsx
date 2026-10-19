'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '📊' },
  { name: 'Portfolios', href: '/dashboard/portfolios', icon: '💼' },
  { name: 'Macro Risk Models', href: '/dashboard/risk-models', icon: '📈' },
  { name: 'Profile', href: '/dashboard/settings', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-64 flex-col justify-between border-r border-slate-800 bg-slate-900 p-4">
      <div>
        <div className="flex items-center gap-3 px-3 py-4 border-b border-slate-800 mb-6">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-lg">
            H
          </div>
          <div>
            <h1 className="font-bold text-white text-base leading-none">Hustix Macro</h1>
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
        <p className="font-semibold text-slate-300">Advisor Suite</p>
        <p className="flex items-center gap-1.5 text-[11px] mt-1 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Session Secure
        </p>
      </div>
    </aside>
  );
}
