'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

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

type AppliedPromotion = {
  code: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  starts_on: string | null;
  ends_on: string | null;
};

type Advisor = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  firm_name: string;
  enabled: boolean;
  plan_code: string;
  applied_promotions: AppliedPromotion[];
  agreement_version: string;
  agreement_signed_at: string | null;
  last_seen: string | null;
};

type Promotion = {
  code: string;
  label: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to: string[];
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type AdminState = {
  plans: Plan[];
  accounts: Account[];
  accounts_error: string | null;
  advisors: Advisor[];
  promotions: Promotion[];
  advisors_error: string | null;
};

type FirmSummary = {
  id: string;
  name: string;
  plan_code: string;
  subscription_status: string;
  enabled: boolean;
  member_count: number;
  portfolio_count: number;
  created_on: string;
};

type FirmDetail = FirmSummary & {
  holdings_classification_source: string | null;
  total_aum: number;
  advisor_count: number;
  portfolio_limit: number | null;
  ticker_limit: number | null;
  advisors: { user_id: string; full_name: string; email: string; role: string; enabled: boolean }[];
  pending_advisors: { invite_id: string; full_name: string; email: string; role: string; invited_on: string }[];
  portfolios: { id: string; name: string; portfolio_value: number; advisors: { full_name: string; is_lead: boolean }[] }[];
};

const PLAN_CODES = ['free', 'pro', 'pro_plus', 'enterprise'] as const;

function money(cents: number | null) {
  if (cents == null) return 'Not set';
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function StartGuide() {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-lg font-semibold">How to start</h2>
      <p className="mt-1 text-sm text-slate-400">The same notes are in admin/README.md.</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
        <li>From the hustix-alpha directory, run <code className="text-indigo-200">python3 admin/server.py</code>.</li>
        <li>Open http://127.0.0.1:3090. That console is port 3090.</li>
        <li>Sign in with ADMIN_PASSWORD from admin/.env. The first start writes that file.</li>
        <li>Use Services there to start the frontend on port 3000 and the backend on port 8000.</li>
      </ol>
      <p className="mt-3 text-sm text-slate-400">
        This page, http://127.0.0.1:3000/admin, manages advisors after both are running. It does not start them.
        Logs are admin/logs/frontend.log and admin/logs/backend.log.
      </p>
    </section>
  );
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

function promotionOpen(endsOn: string | null | undefined) {
  if (!endsOn) return true;
  return endsOn >= new Date().toISOString().slice(0, 10);
}

function applicablePromotions(planCode: string, promotions: Promotion[]) {
  return promotions.filter((item) => item.active && promotionOpen(item.ends_at) && item.applies_to.includes(planCode));
}

function promotionLabel(item: {
  code?: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
}) {
  const code = item.code || '';
  if (!code) return 'None';
  const off = item.percent_off != null ? `${item.percent_off}% off` : money(item.amount_off_cents);
  const starts = item.starts_at || item.starts_on;
  const ends = item.ends_at || item.ends_on;
  const range = starts && ends ? ` · ${starts} to ${ends}` : '';
  return `${code} · ${off}${range}`;
}

function listedPromotions(advisor: Advisor, promotions: Promotion[]) {
  const applicable = applicablePromotions(advisor.plan_code, promotions);
  const known = new Set(applicable.map((item) => item.code));
  const extras = (advisor.applied_promotions || [])
    .filter((item) => item.code && !known.has(item.code))
    .map((item) => ({
      code: item.code,
      label: item.code,
      percent_off: item.percent_off,
      amount_off_cents: item.amount_off_cents,
      applies_to: [advisor.plan_code],
      active: true,
      starts_at: item.starts_on,
      ends_at: item.ends_on,
    }));
  return [...applicable, ...extras];
}

function isoDate(day: Date) {
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

function DatePicker({
  value,
  earliest,
  onChange,
}: {
  value: string;
  earliest: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const today = new Date(`${earliest}T00:00:00`);
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [month, setMonth] = useState(() => new Date((selected ?? today).getFullYear(), (selected ?? today).getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ];
  const label = selected
    ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Choose a date';

  return (
    <div ref={root} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100"
      >
        <span className={value ? '' : 'text-slate-500'}>{label}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-300" aria-hidden="true">
          <rect x="2.5" y="4" width="15" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.5 8h15M7 2.5v3M13 2.5v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-20 mt-2 w-64 rounded-lg border border-slate-700 bg-slate-950 p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="px-2 py-1 text-slate-300" aria-label="Previous month">‹</button>
            <span>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="px-2 py-1 text-slate-300" aria-label="Next month">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((name) => <span key={name}>{name}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 text-center text-sm">
            {days.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const past = day < today;
              const chosen = value === isoDate(day);
              return (
                <button
                  key={isoDate(day)}
                  type="button"
                  disabled={past}
                  onClick={() => {
                    onChange(isoDate(day));
                    setOpen(false);
                  }}
                  className={`rounded py-1 ${chosen ? 'bg-indigo-600 text-white' : past ? 'text-slate-600' : 'text-slate-100 hover:bg-slate-800'}`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PromotionList({ advisor, promotions }: { advisor: Advisor; promotions: Promotion[] }) {
  const applicable = listedPromotions(advisor, promotions);
  const applied = new Set((advisor.applied_promotions || []).map((item) => item.code));
  if (applicable.length === 0) {
    return <p className="text-sm text-slate-400">None for this plan.</p>;
  }
  return (
    <ul className="text-sm text-slate-200">
      {applicable.map((item) => (
        <li key={item.code}>
          {promotionLabel(item)}
          {applied.has(item.code) ? ' · applied' : ''}
        </li>
      ))}
    </ul>
  );
}

function formatAum(value: number) {
  return (Number(value) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function FirmsSection() {
  const [firms, setFirms] = useState<FirmSummary[]>([]);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FirmDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFirms() {
    setListError('');
    try {
      const body = await request('/api/admin/firms');
      setFirms(Array.isArray(body.firms) ? body.firms : []);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not load firms.');
      setFirms([]);
    }
  }

  async function loadDetail(firmId: string) {
    setDetailError('');
    setDetail(null);
    try {
      const body = await request(`/api/admin/firms/${firmId}`);
      setDetail(body as FirmDetail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Could not load firm.');
    }
  }

  function selectFirm(firm: FirmSummary) {
    setSelectedId(firm.id);
    setMessage('');
    void loadDetail(firm.id);
  }

  useEffect(() => {
    void loadFirms();
  }, []);

  async function runAction(url: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const result = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setOk(true);
      setMessage('Saved.');
      if (Array.isArray(result.firms)) setFirms(result.firms);
      else await loadFirms();
      if (result.firm) {
        setDetail(result.firm as FirmDetail);
        setSelectedId((result.firm as FirmDetail).id);
      } else if (selectedId) await loadDetail(selectedId);
      return result;
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error ? error.message : 'Could not save.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onLoadFile(file: File) {
    setMessage('');
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = await runAction('/api/admin/firms/load', payload);
      if (result?.firm_id) setSelectedId(String(result.firm_id));
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error ? error.message : 'Could not read JSON.');
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Firms</h2>
          <p className="mt-1 text-sm text-slate-400">
            List, load JSON, enable or disable, and set holdings classification. Portfolio assign and delete firm: run local admin on{' '}
            <code className="text-indigo-200">:3090</code> with <code className="text-indigo-200">ADMIN_DATABASE_URL</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadFirms()} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs">
            Refresh
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onLoadFile(file);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          >
            Load firm JSON
          </button>
        </div>
      </div>
      {listError ? <p className="mt-3 text-sm text-rose-300">{listError}</p> : null}
      {firms.length === 0 && !listError ? <p className="mt-3 text-sm text-slate-400">No firms yet.</p> : null}
      {firms.length > 0 ? (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 pr-3 font-medium">Advisors</th>
              <th className="py-2 pr-3 font-medium">Portfolios</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((firm) => (
              <tr
                key={firm.id}
                className={`cursor-pointer border-t border-slate-800 ${firm.id === selectedId ? 'bg-slate-800/60' : ''}`}
                onClick={() => selectFirm(firm)}
              >
                <td className="py-2 pr-3 font-medium text-indigo-200">{firm.name || 'Unnamed'}</td>
                <td className="py-2 pr-3">{firm.plan_code || '—'}</td>
                <td className="py-2 pr-3">{firm.member_count ?? '—'}</td>
                <td className="py-2 pr-3">{firm.portfolio_count ?? '—'}</td>
                <td className="py-2 pr-3">{firm.created_on || '—'}</td>
                <td className="py-2">{firm.enabled ? 'Enabled' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {detailError ? <p className="mt-3 text-sm text-rose-300">{detailError}</p> : null}
      {detail ? (
        <div className="mt-5 space-y-4 border-t border-slate-800 pt-4">
          <p className="text-sm text-slate-300">
            {detail.name} · {formatAum(detail.total_aum)} AUM · {detail.advisor_count} advisors · {detail.portfolio_count} portfolios
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction('/api/admin/firms/access', { firm_id: detail.id, enabled: !detail.enabled })}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-60"
            >
              {detail.enabled ? 'Disable firm' : 'Enable firm'}
            </button>
            <label className="block text-xs text-slate-400">
              Holdings classification
              <select
                value={detail.holdings_classification_source || 'csv'}
                disabled={busy}
                onChange={(event) => {
                  void runAction(`/api/admin/firms/${detail.id}/holdings-classification`, { source: event.target.value });
                }}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="csv">CSV (file asset_class)</option>
                <option value="authoritative">Tiingo (authoritative)</option>
              </select>
            </label>
          </div>
          {(detail.advisors?.length ?? 0) > 0 ? (
            <div>
              <p className="text-xs text-slate-400">Advisors</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                {detail.advisors.map((advisor) => (
                  <li key={advisor.user_id}>
                    {advisor.full_name || advisor.email} · {advisor.email} · {advisor.enabled ? 'enabled' : 'disabled'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(detail.pending_advisors?.length ?? 0) > 0 ? (
            <div>
              <p className="text-xs text-slate-400">Pending invites</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                {detail.pending_advisors.map((invite) => (
                  <li key={invite.invite_id}>
                    {invite.full_name || invite.email} · invited {invite.invited_on}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(detail.portfolios?.length ?? 0) > 0 ? (
            <div>
              <p className="text-xs text-slate-400">Portfolios (read-only here)</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                {detail.portfolios.map((portfolio) => (
                  <li key={portfolio.id}>
                    {portfolio.name} · {formatAum(portfolio.portfolio_value)}
                    {(portfolio.advisors?.length ?? 0) > 0
                      ? ` · ${portfolio.advisors.map((a) => `${a.full_name}${a.is_lead ? ' (lead)' : ''}`).join(', ')}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p className={`mt-3 text-sm ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message}</p> : null}
    </section>
  );
}

function AdvisorSection({
  state,
  onDirectory,
  onRefresh,
}: {
  state: AdminState;
  onDirectory: (directory: { advisors: Advisor[]; promotions: Promotion[] }) => void;
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [firm, setFirm] = useState('');
  const [phone, setPhone] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoKind, setPromoKind] = useState<'percent' | 'amount'>('percent');
  const [promoValue, setPromoValue] = useState('');
  const [promoPlans, setPromoPlans] = useState<string[]>(['pro', 'pro_plus']);
  const [promoStarts, setPromoStarts] = useState('');
  const [promoEnds, setPromoEnds] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const selected = state.advisors.find((advisor) => advisor.id === selectedId) || null;
  const appliedKey = (selected?.applied_promotions || []).map((item) => item.code).sort().join('\n');

  useEffect(() => {
    setChosen(appliedKey ? appliedKey.split('\n') : []);
  }, [selected?.id, appliedKey]);

  function choose(advisor: Advisor) {
    setSelectedId(advisor.id);
    setName(advisor.full_name);
    setFirm(advisor.firm_name);
    setPhone(advisor.phone);
    setMessage('');
  }

  async function run(url: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const directory = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onDirectory(directory);
      setOk(true);
      setMessage('Saved.');
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error ? error.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const signed = selected?.agreement_signed_at ? new Date(selected.agreement_signed_at) : null;
  const seen = selected?.last_seen ? new Date(selected.last_seen) : null;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Advisors</h2>
        <button type="button" onClick={onRefresh} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs">
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Access, subscription, promotion, agreement, and contact details for every advisor.
      </p>
      {state.advisors_error ? <p className="mt-3 text-sm text-rose-300">{state.advisors_error}</p> : null}
      {state.advisors.length === 0 && !state.advisors_error ? (
        <p className="mt-3 text-sm text-slate-400">No advisors yet.</p>
      ) : null}
      {state.advisors.length > 0 ? (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 pr-3 font-medium">Promotions</th>
              <th className="py-2 pr-3 font-medium">Agreement</th>
              <th className="py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {state.advisors.map((advisor) => (
              <tr
                key={advisor.id}
                className={`cursor-pointer border-t border-slate-800 ${advisor.id === selectedId ? 'bg-slate-800/60' : ''}`}
                onClick={() => choose(advisor)}
              >
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => choose(advisor)} className="text-left font-medium text-indigo-200">
                    {advisor.full_name || 'Unnamed advisor'}
                  </button>
                </td>
                <td className="py-2 pr-3">{advisor.email || '—'}</td>
                <td className="py-2 pr-3">{advisor.plan_code || '—'}</td>
                <td className="py-2 pr-3">
                  <PromotionList advisor={advisor} promotions={state.promotions} />
                </td>
                <td className="py-2 pr-3">{advisor.agreement_version || 'None'}</td>
                <td className="py-2">{advisor.enabled ? 'Enabled' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!selected && state.advisors.length > 0 ? (
        <p className="mt-3 text-sm text-slate-400">Select an advisor to apply a promotion.</p>
      ) : null}

      {selected ? (
        <div className="mt-5 space-y-4 border-t border-slate-800 pt-4">
          <p className="text-sm text-slate-300">
            {selected.email || 'No email'}
            {seen && !Number.isNaN(seen.getTime()) ? ` · last active ${seen.toLocaleString()}` : ''}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs text-slate-400">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
            <label className="block text-xs text-slate-400">
              Firm
              <input value={firm} onChange={(event) => setFirm(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
            <label className="block text-xs text-slate-400">
              Phone
              <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('/api/admin/advisors/contact', { user_id: selected.id, full_name: name, firm_name: firm, phone })}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Save contact
          </button>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-xs text-slate-400">
              Subscription
              <select value="pro_plus" disabled className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-70">
                <option value="pro_plus">Pro+</option>
              </select>
            </label>
            <p className="pb-2 text-xs text-slate-500">During this phase every account is Pro+.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('/api/admin/advisors/access', { user_id: selected.id, enabled: !selected.enabled })}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-60"
            >
              {selected.enabled ? 'Disable account' : 'Enable account'}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-400">Apply promotions</p>
            {listedPromotions(selected, state.promotions).length === 0 ? (
              <p className="text-sm text-slate-400">None for this plan. Save a promotion below, then check it here.</p>
            ) : (
              <ul className="space-y-1 text-sm text-slate-200">
                {listedPromotions(selected, state.promotions).map((item) => (
                  <li key={item.code}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={chosen.includes(item.code)}
                        onChange={(event) => {
                          setChosen((current) => (
                            event.target.checked
                              ? [...current, item.code]
                              : current.filter((code) => code !== item.code)
                          ));
                        }}
                      />
                      {promotionLabel(item)}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('/api/admin/advisors/promotion', { user_id: selected.id, codes: chosen })}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-60"
            >
              Apply promotions
            </button>
          </div>

          <p className="text-sm text-slate-300">
            Agreement {selected.agreement_version || 'not accepted'}
            {signed && !Number.isNaN(signed.getTime()) ? ` · signed ${signed.toLocaleString()}` : ''}
          </p>
          {message ? <p className={`text-sm ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message}</p> : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h3 className="text-sm font-semibold">Saved promotions</h3>
        {state.promotions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No promotions saved.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-slate-200">
            {state.promotions.map((item) => (
              <li key={item.code}>
                {promotionLabel(item)}
                {item.applies_to.length ? ` · ${item.applies_to.join(', ')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="mt-5 space-y-3 border-t border-slate-800 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(promoValue);
          if (!Number.isFinite(value) || value <= 0) {
            setOk(false);
            setMessage(promoKind === 'percent' ? 'Enter a percent from 1 to 100.' : 'Enter a dollar amount.');
            return;
          }
          if (!promoStarts || !promoEnds) {
            setOk(false);
            setMessage('Choose a start date and an end date.');
            return;
          }
          if (promoEnds < promoStarts) {
            setOk(false);
            setMessage('The end date must be on or after the start date.');
            return;
          }
          const code = promoCode.trim().toUpperCase();
          if (!/^[A-Z0-9]{2,12}$/.test(code)) {
            setOk(false);
            setMessage(code ? 'Use 2 to 12 letters or numbers.' : 'Enter a promotion code.');
            return;
          }
          void run('/api/admin/promotions', {
            code,
            percent_off: promoKind === 'percent' ? Math.round(value) : null,
            amount_off_cents: promoKind === 'amount' ? Math.round(value * 100) : null,
            applies_to: promoPlans,
            starts_on: promoStarts,
            ends_on: promoEnds,
          });
        }}
      >
        <h3 className="text-sm font-semibold">New promotion</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-400 sm:col-span-2">
            Code
            <input value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="S20" maxLength={12} aria-label="Code" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase" />
          </label>
          <label className="block text-xs text-slate-400">
            Starts
            <DatePicker
              value={promoStarts}
              earliest={today}
              onChange={(next) => {
                setPromoStarts(next);
                if (promoEnds && promoEnds < next) setPromoEnds('');
              }}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Ends
            <DatePicker value={promoEnds} earliest={promoStarts || today} onChange={setPromoEnds} />
          </label>
          <select value={promoKind} onChange={(event) => setPromoKind(event.target.value === 'amount' ? 'amount' : 'percent')} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <option value="percent">Percent off</option>
            <option value="amount">Dollars off</option>
          </select>
          <input value={promoValue} onChange={(event) => setPromoValue(event.target.value)} inputMode="decimal" placeholder={promoKind === 'percent' ? '20' : '50'} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
          {PLAN_CODES.map((code) => (
            <label key={code} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={promoPlans.includes(code)}
                onChange={(event) => {
                  setPromoPlans((current) => (
                    event.target.checked ? [...current, code] : current.filter((item) => item !== code)
                  ));
                }}
              />
              {code}
            </label>
          ))}
        </div>
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold disabled:opacity-60">
          Save promotion
        </button>
      </form>
    </section>
  );
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
    setState({
      plans,
      accounts,
      accounts_error: next.accounts_error ?? null,
      advisors: (Array.isArray(next.advisors) ? next.advisors : []).map((advisor) => ({
        ...advisor,
        applied_promotions: Array.isArray(advisor.applied_promotions) ? advisor.applied_promotions : [],
      })),
      promotions: Array.isArray(next.promotions) ? next.promotions : [],
      advisors_error: next.advisors_error ?? null,
    });
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
      <div className="mx-auto max-w-5xl px-5 py-8">
        {!ready ? <p className="text-sm text-slate-400">Loading admin...</p> : null}

        {ready && !signedIn ? (
          <div className="space-y-5">
          <StartGuide />
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
          </div>
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
            <StartGuide />
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Admin</h1>
                <p className="mt-1 text-sm text-slate-400">Firms, advisors, subscriptions, and plan caps on the cloud database.</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
              >
                Sign out
              </button>
            </div>

            <FirmsSection />

            <AdvisorSection
              state={state}
              onDirectory={(directory) => applyState({ ...state, ...directory, advisors_error: null })}
              onRefresh={() => loadState().catch((error) => setLimitsMessage(error instanceof Error ? error.message : 'Could not refresh.'))}
            />

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
