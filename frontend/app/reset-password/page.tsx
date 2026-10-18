'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [fromLink] = useState(() => {
    if (typeof window === 'undefined') return false;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    return hash.get('type') === 'recovery' || query.get('type') === 'recovery' || query.has('code');
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || (fromLink && event === 'SIGNED_IN')) {
        setReady(true);
        setChecking(false);
      }
    });

    const timer = window.setTimeout(async () => {
      if (fromLink) {
        const { data } = await supabase.auth.getSession();
        if (data.session) setReady(true);
      }
      setChecking(false);
    }, 1500);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [fromLink]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    router.push('/dashboard');
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
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
            <img src="/favicon.png" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">Hustix Macro</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Choose a new password</h2>
          <p className="text-xs text-slate-400">This replaces the password on the account from the reset link.</p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-center gap-2">
            <span>&bull;</span>
            <span>{error}</span>
          </div>
        )}

        {checking ? (
          <p className="text-xs text-slate-400 text-center">Checking your reset link...</p>
        ) : ready ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col">
              <label className="block text-xs font-medium text-slate-300 mb-2 leading-none">
                New password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
                placeholder="••••••••"
              />
            </div>
            <div className="flex flex-col">
              <label className="block text-xs font-medium text-slate-300 mb-2 leading-none">
                Confirm password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
            >
              {saving ? 'Saving password...' : 'Save password'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg">
              This reset link is invalid or has expired. Request a new one.
            </div>
            <Link
              href="/forgot-password"
              className="block w-full py-3 text-center bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
            >
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
