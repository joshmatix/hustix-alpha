'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ensureProfile } from '@/lib/ensureProfile';
import { AGREEMENT_TITLE, AGREEMENT_VERSION } from '@/lib/agreement';
import { hasVerifiedAuthenticator } from '@/lib/mfa';
import { oauthErrorMessage, startOAuth, type OAuthProvider } from '@/lib/oauth';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import AuthenticatorEnroll from '@/components/auth/AuthenticatorEnroll';
import { signupPlanDetail } from '@/lib/planLimits';
import AgreementBody from '@/components/auth/AgreementBody';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type CatalogPlan = {
  code: string;
  name: string;
  monthly_cents: number;
  portfolio_limit: number | null;
  ticker_limit: number | null;
};

function money(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [plan, setPlan] = useState('free');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [plansLoading, setPlansLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<'account' | 'authenticator'>('account');
  const [oauthUserId, setOauthUserId] = useState<string | null>(null);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const router = useRouter();
  const selected = plans.find((option) => option.code === plan) || plans[0];

  useEffect(() => {
    supabase.rpc('plan_catalog').then(({ data, error: catalogError }) => {
      const rows = Array.isArray(data) ? (data as CatalogPlan[]) : [];
      setPlans(rows);
      if (rows.some((row) => row.code === 'free')) {
        setPlan('free');
      } else if (rows[0]) {
        setPlan(rows[0].code);
      }
      if (catalogError) {
        setError(catalogError.message);
      }
      setPlansLoading(false);
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session) return;
      const signedInEmail = session.user.email ?? null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('agreement_version, firm_name, full_name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!profile?.agreement_version) {
        setOauthUserId(session.user.id);
        if (signedInEmail) setEmail(signedInEmail);
        if (profile?.full_name) setFullName(profile.full_name);
        if (profile?.firm_name) setFirmName(profile.firm_name);
        return;
      }
      setActiveEmail(signedInEmail);
      if (!(await hasVerifiedAuthenticator())) {
        setStep('authenticator');
      }
    });
  }, [router]);

  const startFreshAccount = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    await supabase.auth.signOut();
    setOauthUserId(null);
    setActiveEmail(null);
    setEmail('');
    setFullName('');
    setFirmName('');
    setPassword('');
    setAgreed(false);
    setStep('account');
    setLoading(false);
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    if (activeEmail) await supabase.auth.signOut();
    const oauthError = await startOAuth(provider);
    if (oauthError) {
      setError(oauthErrorMessage(oauthError.message, provider));
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (!agreed) {
      setError('Check the box to accept the customer agreement.');
      setLoading(false);
      return;
    }

    const name = fullName.trim();
    if (!name) {
      setError('Enter your name.');
      setLoading(false);
      return;
    }

    const firm = firmName.trim();
    if (!firm) {
      setError('Enter the firm name.');
      setLoading(false);
      return;
    }

    const acceptedAt = new Date().toISOString();
    if (oauthUserId) {
      const profileError = await ensureProfile(oauthUserId);
      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: name,
          firm_name: firm,
          agreement_version: AGREEMENT_VERSION,
          agreement_accepted_at: acceptedAt,
        })
        .eq('id', oauthUserId);
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
      setLoading(false);
      setStep('authenticator');
      return;
    }

    if (activeEmail) await supabase.auth.signOut();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          plan,
          full_name: name,
          firm_name: firm,
          agreement_version: AGREEMENT_VERSION,
          agreement_accepted_at: acceptedAt,
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Email confirmation leaves session null, so the auth.users trigger is the
    // only writer until the user signs in. When a session exists, create the
    // row here too — hosted projects often never installed that trigger.
    if (data.session && data.user) {
      const profileError = await ensureProfile(data.user.id);
      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }
      await supabase
        .from('profiles')
        .update({
          full_name: name,
          firm_name: firm,
          agreement_version: AGREEMENT_VERSION,
          agreement_accepted_at: acceptedAt,
        })
        .eq('id', data.user.id);
      const { data: membership } = await supabase
        .from('firm_members')
        .select('firm_id')
        .eq('user_id', data.user.id)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      if (membership?.firm_id) {
        await supabase.from('firms').update({ name: firm }).eq('id', membership.firm_id);
      }
      setLoading(false);
      setStep('authenticator');
      return;
    }

    setNotice('You are not signed in. Sign in if this address already has an account. A new address gets a confirmation message before sign-in. The authenticator app is required before the dashboard opens.');
    setLoading(false);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      {/* Back to Home Link */}
      <div className="w-full max-w-3xl mb-6">
        <Link 
          href="/" 
          className="inline-flex items-center text-xs font-medium text-slate-400 hover:text-slate-200 transition"
        >
          &larr; Back to Home
        </Link>
      </div>

      {/* Register Card */}
      <div className="w-full max-w-3xl bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-xl backdrop-blur-sm space-y-6">
        {/* Card Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <img src="/favicon.png" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">Hustix Macro</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            {step === 'authenticator' ? 'Authenticator app' : 'Create Account'}
          </h2>
          <p className="text-xs text-slate-400">
            {step === 'authenticator'
              ? 'Add an authenticator app to finish this account.'
              : oauthUserId
                ? 'Confirm your name and firm, then accept the agreement to finish this sign-in.'
                : 'Register as a wealth advisor to start running scenario analytics.'}
          </p>
        </div>

        {/* Error Banner */}
        {notice && (
          <div className="p-3 bg-slate-800/80 border border-slate-700 text-slate-200 text-xs rounded-lg">
            {notice}{' '}
            <Link href="/login" className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline">
              Sign in
            </Link>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-center gap-2">
            <span>&bull;</span>
            <span>{error}</span>
          </div>
        )}

        {/* Form with Aligned Spacing */}
        {activeEmail && step === 'account' && oauthUserId === null && (
          <div className="p-3 bg-slate-800/80 border border-slate-700 text-slate-200 text-xs rounded-lg">
            This browser is signed in as {activeEmail}. Enter another email to create a separate account. Submitting signs that session out.
          </div>
        )}

        {step === 'authenticator' ? (
          <>
            <AuthenticatorEnroll onVerified={() => router.push('/dashboard')} />
            <button
              type="button"
              onClick={() => void startFreshAccount()}
              className="w-full text-center text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              Create an account with another email
            </button>
          </>
        ) : (
        <>
        {oauthUserId === null && (
          <OAuthButtons disabled={loading} onProvider={(provider) => void handleOAuth(provider)} />
        )}
        <form onSubmit={handleSignup} className="space-y-5">
          {oauthUserId === null && (
          <fieldset className="space-y-2">
            <legend className="block text-xs font-medium text-slate-300 mb-2 leading-none">
              Account
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plansLoading && <p className="text-xs text-slate-400">Loading plans...</p>}
              {plans.map((option) => {
                const chosen = plan === option.code;
                return (
                  <label
                    key={option.code}
                    className={`cursor-pointer rounded-lg border px-4 py-3 transition ${
                      chosen
                        ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/40'
                        : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={option.code}
                      checked={chosen}
                      onChange={() => setPlan(option.code)}
                      className="sr-only"
                    />
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{option.name}</span>
                      <span className="text-sm font-semibold text-indigo-300">{money(option.monthly_cents)}</span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {signupPlanDetail(option.monthly_cents, option.portfolio_limit, option.ticker_limit)}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Choosing a paid plan records that monthly price. This screen does not charge a card.
            </p>
          </fieldset>
          )}

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-slate-300 mb-2 leading-none" htmlFor="full-name">
              Full Name
            </label>
            <input
              id="full-name"
              type="text"
              required
              autoComplete="name"
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
              placeholder="Sarah Jenkins"
            />
          </div>

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-slate-300 mb-2 leading-none" htmlFor="firm-name">
              Firm Name
            </label>
            <input
              id="firm-name"
              type="text"
              required
              maxLength={120}
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
              placeholder="Northwind Wealth"
            />
          </div>

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-slate-300 mb-2 leading-none">
              Work Email
            </label>
            <input
              type="email"
              required
              readOnly={oauthUserId !== null}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950/70 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition read-only:text-slate-400"
              placeholder="advisor@example.com"
            />
          </div>

          {oauthUserId === null && (
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
              placeholder="Create a strong password"
            />
          </div>
          )}

          <div className="rounded-lg border border-slate-800 bg-slate-950/70">
            <div className="max-h-56 overflow-y-auto px-4 py-3">
              <AgreementBody />
            </div>
          </div>

          <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-300">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
              required
            />
            <span>
              I have read and agree to the {AGREEMENT_TITLE} (version {AGREEMENT_VERSION}).{' '}
              <Link href="/agreement" className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline">
                Open the agreement
              </Link>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || fullName.trim() === '' || email.trim() === '' || (oauthUserId === null && password === '')}
            className="w-full py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-semibold rounded-lg text-sm transition shadow-lg shadow-indigo-600/20"
          >
            {loading ? 'Creating Account...' : oauthUserId ? 'I agree and continue' : 'I agree and create account'}
          </button>
          {oauthUserId && (
            <button
              type="button"
              onClick={() => void startFreshAccount()}
              className="w-full text-center text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              Create an account with another email
            </button>
          )}
        </form>
        </>
        )}

        {/* Card Footer */}
        <div className="border-t border-slate-800/80 pt-4 text-center">
          <p className="text-xs text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}