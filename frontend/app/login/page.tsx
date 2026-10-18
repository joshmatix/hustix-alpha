'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { authenticatorStillRequired, hasVerifiedAuthenticator } from '@/lib/mfa';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const router = useRouter();

  async function beginAuthenticator() {
    const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    if (factorError || !factor) {
      setError(factorError?.message || 'No authenticator app is set up for this account.');
      setLoading(false);
      return;
    }
    setFactorId(factor.id);
    setStep('code');
    setLoading(false);
  }

  useEffect(() => {
    if (sessionStorage.getItem('hustix_idle_signout') !== '1') return;
    sessionStorage.removeItem('hustix_idle_signout');
    setNotice('You were signed out after 15 minutes of inactivity.');
  }, []);

  useEffect(() => {
    void authenticatorStillRequired().then((needsCode) => {
      if (needsCode) void beginAuthenticator();
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (await authenticatorStillRequired()) {
      await beginAuthenticator();
      return;
    }

    if (!(await hasVerifiedAuthenticator())) {
      router.push('/signup');
      return;
    }

    router.push('/dashboard');
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    if (verifyError) {
      setError(verifyError.message);
      setLoading(false);
      return;
    }
    router.push('/dashboard');
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6">
      {/* Back to Home Link */}
      <div className="w-full max-w-md mb-6">
        <Link 
          href="/" 
          className="inline-flex items-center text-xs font-medium text-slate-400 hover:text-slate-200 transition"
        >
          &larr; Back to Home
        </Link>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-xl backdrop-blur-sm space-y-6">
        {/* Card Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">Hustix Macro</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            {step === 'code' ? 'Authenticator code' : 'Welcome Back'}
          </h2>
          <p className="text-xs text-slate-400">
            {step === 'code'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter your credentials to access your macro-risk workspace.'}
          </p>
        </div>

        {/* Error Banner */}
        {notice && (
          <div className="p-3 bg-slate-800/80 border border-slate-700 text-slate-200 text-xs rounded-lg">
            {notice}
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-center gap-2">
            <span>&bull;</span>
            <span>{error}</span>
          </div>
        )}

        {/* Form with Aligned Spacing */}
        {step === 'code' ? (
          <form onSubmit={handleCode} className="space-y-5">
            <div className="flex flex-col">
              <label className="mb-2 block text-xs font-medium leading-none text-slate-300" htmlFor="authenticator-code">
                Authenticator code
              </label>
              <input
                id="authenticator-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !factorId}
              className="mt-4 w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:bg-indigo-600/50"
            >
              {loading ? 'Checking code...' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={() => {
                void supabase.auth.signOut().then(() => {
                  setStep('password');
                  setCode('');
                  setFactorId('');
                  setError(null);
                });
              }}
              className="w-full text-center text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              Use a different account
            </button>
          </form>
        ) : (
        <form onSubmit={handleLogin} className="space-y-5">
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

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-slate-300 mb-2 leading-none">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
              placeholder="••••••••"
            />
            <Link
              href="/forgot-password"
              className="mt-2 self-end text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <p className="text-center text-xs text-slate-400">
            By logging in, you agree to our{' '}
            <Link href="/agreement" className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline">
              Customer Agreement
            </Link>.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        )}

        {/* Card Footer */}
        <div className="border-t border-slate-800/80 pt-4 text-center">
          <p className="text-xs text-slate-400">
            Don't have an advisor account?{' '}
            <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline">
              Register here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
