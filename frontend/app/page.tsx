'use client';

import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-between bg-slate-950 p-6 text-slate-100 md:p-12">
      {/* Header Bar */}
      <header className="w-full max-w-6xl mx-auto flex justify-between items-center py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
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

      {/* Hero Content Section */}
      <section className="w-full max-w-4xl mx-auto text-center my-16 space-y-6">
        <div className="inline-block px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800/50 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
          B2B Macro-Risk Engine
        </div>
        
        <h2 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">
          Quantify Macroeconomic Risk for Wealth Advisors
        </h2>
        
        <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto font-normal">
          Stress-test client portfolios against stagflation, rate shocks, and recession scenarios using institutional-grade Monte Carlo simulations.
        </p>
      </section>

      {/* Navigation Purpose Cards */}
      <section className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Existing Users / Sign In Card */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3 hover:border-slate-700 transition">
          <h3 className="text-lg font-semibold text-white">Already have an account?</h3>
          <p className="text-sm text-slate-400">
            Sign in if you are already registered to access your saved portfolio stress tests and dashboard.
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex items-center text-sm font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Sign In to Dashboard &rarr;
            </Link>
          </div>
        </div>

        {/* New Users / Register Card */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3 hover:border-slate-700 transition">
          <h3 className="text-lg font-semibold text-white">New to Hustix Macro?</h3>
          <p className="text-sm text-slate-400">
            Register for a new account to create advisor profiles and run macro scenario analytics.
          </p>
          <div className="pt-2">
            <Link
              href="/signup"
              className="inline-flex items-center text-sm font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Explore Scenarios Free &rarr;
            </Link>
          </div>
        </div>
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