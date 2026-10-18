'use client';

import Link from 'next/link';
import HeroReel from '@/components/home/HeroReel';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-between bg-slate-950 p-6 text-slate-100 md:p-12">
      {/* Header Bar */}
      <header className="w-full max-w-6xl mx-auto flex justify-between items-center py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="" className="h-8 w-8 rounded-lg" />
          <h1 className="text-xl font-bold tracking-tight text-white">
            Hustix <span className="text-indigo-400">Macro</span>
          </h1>
        </div>

        {/* Header Action Buttons (Spaced out) */}
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-md shadow-indigo-500/10 transition-all"
          >
            Get Started Free
          </Link>
        </div>
      </header>

      <section className="relative -mx-6 my-10 overflow-hidden px-6 py-16 md:-mx-12 md:px-12">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <HeroReel />
          <div className="absolute inset-0 bg-black/20" />
        </div>
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800/50 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
            B2B Macro-Risk Engine
          </div>

          <h2 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">
            Quantify Macroeconomic Risk for Wealth Advisors
          </h2>

          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto font-normal">
            Stress-test client portfolios against stagflation, rate shocks, and recession scenarios using institutional-grade Monte Carlo simulations.
          </p>
          <Link
            href="/signup"
            className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-500/10 transition-all hover:bg-indigo-500"
          >
            Get Started Free
          </Link>
          <p className="mx-auto max-w-2xl text-sm font-normal text-slate-500 md:text-base">
            Built for modern ticker-based allocations. Instantly model portfolios composed of Bond ETFs, Mutual Funds, and Equities without manual spreadsheet mapping.
          </p>
        </div>
      </section>

      <section className="mx-auto mb-12 grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-slate-700">
          <h3 className="text-lg font-semibold text-white">Enterprise Security, Built for Compliance</h3>
          <ul className="list-disc space-y-3 pl-5 text-sm text-slate-400">
            <li>
              <span className="font-medium text-slate-200">Mandatory Multi-Factor Authentication:</span> Every account is protected by strict 2FA via Twilio Authy, Google Authenticator, or Microsoft Authenticator to safeguard advisor pipelines.
            </li>
            <li>
              <span className="font-medium text-slate-200">Institutional Encryption:</span> Your data is fully encrypted using AES-256 at rest and TLS 1.3 in transit.
            </li>
            <li>
              <span className="font-medium text-slate-200">Vendor Due Diligence Ready:</span> Designed from the ground up to satisfy SEC cybersecurity compliance standards for RIA software vendors.
            </li>
          </ul>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-slate-700">
          <h3 className="text-lg font-semibold text-white">Run Sophisticated Economic Scenarios In Seconds</h3>
          <ul className="list-disc space-y-3 pl-5 text-sm text-slate-400">
            <li>
              <span className="font-medium text-slate-200">Monetary Policy Shocks:</span> Model sudden, aggressive Federal Reserve rate hikes or unexpected quantitative tightening regimes.
            </li>
            <li>
              <span className="font-medium text-slate-200">Inflation & Stagflation Regimes:</span> Test portfolio resilience against persistent sticky inflation and contracting GDP growth.
            </li>
            <li>
              <span className="font-medium text-slate-200">Systemic Recessions:</span> Simulate historical market drawdowns (like 1970s stagflation or the 2008 financial crisis) mapped against your modern asset mix.
            </li>
          </ul>
        </div>
      </section>

      <section className="mx-auto mb-10 w-full max-w-2xl space-y-4 text-center">
        <Link
          href="/signup"
          className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-500/10 transition-all hover:bg-indigo-500"
        >
          Get Started Free
        </Link>
        <p className="text-sm text-slate-400">
          Create your advisor profile, build up to 3 custom ticker-based portfolios, and run unlimited baseline recession stress-tests. No credit card required.
        </p>
      </section>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-6xl space-y-2 border-t border-slate-900 pt-6 text-center text-xs text-slate-500">
        <p>Hustix Macro &copy; {new Date().getFullYear()} — Quantitative Portfolio Simulation</p>
        <p>
          <Link href="/agreement" className="text-indigo-300 hover:text-indigo-200">
            Customer Agreement
          </Link>
        </p>
      </footer>
    </main>
  );
}