'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md mb-6">
        <Link
          href="/login"
          className="inline-flex items-center text-xs font-medium text-slate-400 hover:text-slate-200 transition"
        >
          &larr; Back to sign in
        </Link>
      </div>

      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-xl backdrop-blur-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">Hustix Macro</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Reset your password</h2>
          <p className="text-xs text-slate-400">
            Enter the work email on the account. We will send a link to choose a new password.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-center gap-2">
            <span>&bull;</span>
            <span>{error}</span>
          </div>
        )}

        {sent ? (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-lg">
              If an account exists for {email}, a reset link is on its way. Open it in this browser.
            </div>
            <Link
              href="/login"
              className="block w-full py-3 text-center bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
            >
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col">
              <label className="block text-xs font-medium text-slate-300 mb-2 leading-none">
                Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
                placeholder="advisor@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
            >
              {loading ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
