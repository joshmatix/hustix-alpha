'use client';

import { FormEvent, useEffect, useState } from 'react';

type Plan = {
  code: string;
  name: string;
  monthly_cents: number | null;
  portfolio_limit: number | null;
  ticker_limit: number | null;
};

type Account = {
  email: string;
  full_name: string;
  firm_name: string;
  plan_code: string;
  last_seen: string;
};

type AdminState = {
  plans: Plan[];
  accounts: Account[];
  accounts_error: string | null;
};

function money(cents: number | null) {
  if (cents == null) return 'Not set';
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : 'Request failed.';
    throw new Error(detail);
  }
  return body;
}

export default function CloudAdminPage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [stateError, setStateError] = useState('');
  const [state, setState] = useState<AdminState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { portfolio_limit: string; ticker_limit: string }>>({});
  const [limitsMessage, setLimitsMessage] = useState('');
  const [limitsOk, setLimitsOk] = useState(false);
  const [saving, setSaving] = useState(false);

  function applyState(next: AdminState) {
    const plans = Array.isArray(next.plans) ? next.plans : [];
    const accounts = Array.isArray(next.accounts) ? next.accounts : [];
    setState({ plans, accounts, accounts_error: next.accounts_error ?? null });
    const fields: Record<string, { portfolio_limit: string; ticker_limit: string }> = {};
    for (const plan of plans) {
      fields[plan.code] = {
        portfolio_limit: plan.portfolio_limit == null ? '' : String(plan.portfolio_limit),
        ticker_limit: plan.ticker_limit == null ? '' : String(plan.ticker_limit),
      };
    }
    setDrafts(fields);
    setStateError('');
  }

  async function loadState() {
    applyState(await request('/api/admin/state'));
  }

  useEffect(() => {
    request('/api/admin/session')
      .then(async (body) => {
        if (!body.signed_in) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);
        try {
          await loadState();
        } catch (error) {
          setStateError(error instanceof Error ? error.message : 'Could not load the database.');
        }
      })
      .catch(() => setSignedIn(false))
      .finally(() => setReady(true));
  }, []);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError('');
    try {
      await request('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Could not sign in.');
      return;
    }
    setPassword('');
    setSignedIn(true);
    setState(null);
    setStateError('');
    try {
      await loadState();
    } catch (error) {
      setStateError(error instanceof Error ? error.message : 'Could not load the database.');
    }
  }

  async function onLogout() {
    await request('/api/admin/logout', { method: 'POST' }).catch(() => undefined);
    setSignedIn(false);
    setState(null);
    setStateError('');
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!state) return;
    setLimitsMessage('');
    setLimitsOk(false);
    const plans = state.plans.map((plan) => {
      const draft = drafts[plan.code] || { portfolio_limit: '', ticker_limit: '' };
      return {
        code: plan.code,
        portfolio_limit: draft.portfolio_limit.trim(),
        ticker_limit: draft.ticker_limit.trim(),
      };
    });
    for (const plan of plans) {
      if (
        (plan.portfolio_limit !== '' && !/^\d+$/.test(plan.portfolio_limit))
        || (plan.ticker_limit !== '' && !/^\d+$/.test(plan.ticker_limit))
      ) {
        setLimitsOk(false);
        setLimitsMessage('Use a whole number, or leave the field empty for no cap.');
        return;
      }
    }
    setSaving(true);
    try {
      const result = await request('/api/admin/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plans: plans.map((plan) => ({
            code: plan.code,
            portfolio_limit: plan.portfolio_limit === '' ? null : Number(plan.portfolio_limit),
            ticker_limit: plan.ticker_limit === '' ? null : Number(plan.ticker_limit),
          })),
        }),
      });
      applyState({ ...(state as AdminState), plans: result.plans });
      setLimitsOk(true);
      setLimitsMessage('Limits saved.');
    } catch (error) {
      setLimitsOk(false);
      setLimitsMessage(error instanceof Error ? error.message : 'Could not save limits.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex-1 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-5 py-8">
        {!ready ? <p className="text-sm text-slate-400">Loading admin...</p> : null}

        {ready && !signedIn ? (
          <section className="max-w-sm rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Cloud database for this site. Vercel keeps the app running, so this screen does not start or stop it.
            </p>
            <form className="mt-4 space-y-3" onSubmit={onLogin}>
              <label className="block text-xs text-slate-300" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              {loginError ? <p className="text-sm text-rose-300">{loginError}</p> : null}
              <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold">
                Sign in
              </button>
            </form>
          </section>
        ) : null}

        {ready && signedIn && !state ? (
          <section className="max-w-lg rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <h1 className="text-2xl font-semibold">Admin</h1>
            {stateError ? (
              <p className="mt-3 text-sm text-rose-300">{stateError}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Loading the database...</p>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm"
            >
              Sign out
            </button>
          </section>
        ) : null}

        {ready && signedIn && state ? (
          <div className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Admin</h1>
                <p className="mt-1 text-sm text-slate-400">Plan caps and signed-in advisors on the cloud database.</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
              >
                Sign out
              </button>
            </div>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Signed-in accounts</h2>
                <button
                  type="button"
                  onClick={() => loadState().catch((error) => setLimitsMessage(error.message))}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs"
                >
                  Refresh
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-400">Advisors with an open session, and the firm account they are on.</p>
              {state.accounts_error ? <p className="mt-3 text-sm text-rose-300">{state.accounts_error}</p> : null}
              {state.accounts.length === 0 && !state.accounts_error ? (
                <p className="mt-3 text-sm text-slate-400">No one is signed in.</p>
              ) : null}
              {state.accounts.length > 0 ? (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Firm</th>
                      <th className="py-2 pr-3 font-medium">Plan</th>
                      <th className="py-2 font-medium">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.accounts.map((account) => {
                      const seen = account.last_seen ? new Date(account.last_seen) : null;
                      return (
                        <tr key={`${account.email}-${account.last_seen}`} className="border-t border-slate-800">
                          <td className="py-2 pr-3">{account.full_name || '—'}</td>
                          <td className="py-2 pr-3">{account.email || '—'}</td>
                          <td className="py-2 pr-3">{account.firm_name || '—'}</td>
                          <td className="py-2 pr-3">{account.plan_code || '—'}</td>
                          <td className="py-2">{seen && !Number.isNaN(seen.getTime()) ? seen.toLocaleString() : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="text-lg font-semibold">Plan limits</h2>
              <p className="mt-1 text-sm text-slate-400">
                Empty means no cap. Portfolios already over a new cap stay. The next one past the cap is refused.
              </p>
              {state.plans.length === 0 ? (
                <p className="mt-3 text-sm text-rose-300">No plans are on this database yet.</p>
              ) : null}
              <form className="mt-3" onSubmit={onSave}>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Plan</th>
                      <th className="py-2 pr-3 font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Portfolios</th>
                      <th className="py-2 font-medium">Tickers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.plans.map((plan) => (
                      <tr key={plan.code} className="border-t border-slate-800">
                        <td className="py-2 pr-3">{plan.name}</td>
                        <td className="py-2 pr-3">{money(plan.monthly_cents)}</td>
                        {(['portfolio_limit', 'ticker_limit'] as const).map((field) => (
                          <td key={field} className="py-2 pr-3">
                            <input
                              inputMode="numeric"
                              placeholder="none"
                              aria-label={`${plan.name} ${field === 'portfolio_limit' ? 'portfolios' : 'tickers'}`}
                              value={drafts[plan.code]?.[field] ?? ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDrafts((current) => ({
                                  ...current,
                                  [plan.code]: {
                                    portfolio_limit: current[plan.code]?.portfolio_limit ?? '',
                                    ticker_limit: current[plan.code]?.ticker_limit ?? '',
                                    [field]: value,
                                  },
                                }));
                              }}
                              className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {limitsMessage ? (
                  <p className={`mt-3 text-sm ${limitsOk ? 'text-emerald-300' : 'text-rose-300'}`}>{limitsMessage}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  Save limits
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
