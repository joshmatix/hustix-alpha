'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Card from '@/components/ui/Card';
import { AdvisorProfileSkeleton, ReportHeaderSkeleton, SkeletonFade } from '@/components/ui/Skeleton';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { portfolioLimitSentence } from '@/lib/planLimits';
import { createCheckoutSession } from '@/lib/stripeCheckout';
import AuthenticatorCard from '@/components/auth/AuthenticatorCard';

type Status = { text: string; type: 'success' | 'error' } | null;
type PlanCode = 'free' | 'pro' | 'pro_plus' | 'enterprise';
type FirmQuote = {
  plan_code: PlanCode;
  plan_name: string;
  status: string;
  seats: number;
  monthly_cents: number | null;
  price_cents: number | null;
  portfolio_limit: number | null;
  ticker_limit: number | null;
  can_manage: boolean;
  promotion: {
    code: string;
    label: string;
    percent_off: number | null;
    amount_off_cents: number | null;
    ends_at: string | null;
  } | null;
};

function money(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function accountLabel(quote: FirmQuote | null, firmName: string) {
  if (!quote) return firmName || 'Free';
  const price =
    quote.price_cents == null
      ? quote.plan_code === 'enterprise'
        ? ' · Price not set'
        : ''
      : ` · ${money(quote.price_cents)} per month`;
  const firm = firmName ? ` · ${firmName}` : '';
  return `${quote.plan_name}${price}${firm}`;
}

function headerLabel(header: Record<string, unknown> | null) {
  if (!header || Object.keys(header).length === 0) {
    return 'Using the default light header.';
  }
  return 'Custom header saved.';
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [planAction, setPlanAction] = useState<PlanCode | null>(null);
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [fullName, setFullName] = useState('');
  const [quote, setQuote] = useState<FirmQuote | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [firmName, setFirmName] = useState('');
  const [reportHeader, setReportHeader] = useState<Record<string, unknown> | null>(null);
  const [headerFileName, setHeaderFileName] = useState('');
  const [pendingHeader, setPendingHeader] = useState<Record<string, unknown> | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameStatus, setNameStatus] = useState<Status>(null);
  const [planStatus, setPlanStatus] = useState<Status>(null);
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);
  const [headerStatus, setHeaderStatus] = useState<Status>(null);

  useEffect(() => {
    async function getProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();

        if (data) {
          setFullName(data.full_name || '');
        }

        const { data: quoted, error: quoteError } = await supabase.rpc('firm_subscription_quote');
        if (quoteError) {
          setPlanStatus({ text: quoteError.message, type: 'error' });
        } else if (quoted) {
          setQuote(quoted as FirmQuote);
        }

        const { data: membership } = await supabase
          .from('firm_members')
          .select('firm_id')
          .eq('user_id', user.id)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle();

        if (membership?.firm_id) {
          const { data: firm } = await supabase
            .from('firms')
            .select('name, report_header')
            .eq('id', membership.firm_id)
            .single();
          if (firm) {
            setFirmName(firm.name || '');
            setReportHeader(
              firm.report_header && typeof firm.report_header === 'object' && !Array.isArray(firm.report_header)
                ? firm.report_header
                : {}
            );
          }
        }
      }
      setLoading(false);
    }

    getProfile();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    setNameStatus(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setNameStatus({ text: 'Sign in again before saving your name.', type: 'error' });
      setSavingName(false);
      return;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setNameStatus({ text: `Update failed: ${error.message}`, type: 'error' });
    } else {
      setNameStatus({ text: 'Name saved.', type: 'success' });
    }
    setSavingName(false);
  };

  const handlePlan = async (target: 'free' | 'pro' | 'pro_plus') => {
    setPlanAction(target);
    setPlanStatus(null);
    if (target === 'pro' || target === 'pro_plus') {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPlanStatus({ text: 'Sign in again before changing the plan.', type: 'error' });
        setPlanAction(null);
        return;
      }
      const result = await createCheckoutSession(target, session.access_token);
      if ('error' in result) {
        setPlanStatus({ text: result.error, type: 'error' });
        setPlanAction(null);
        return;
      }
      window.location.assign(result.url);
      return;
    }
    const { data, error } = await supabase.rpc('set_firm_plan', { target });
    if (error) {
      setPlanStatus({ text: error.message, type: 'error' });
    } else {
      setQuote(data as FirmQuote);
      setPlanStatus({ text: 'Downgraded to Free.', type: 'success' });
    }
    setPlanAction(null);
  };

  const handlePromotion = async () => {
    setApplyingPromo(true);
    setPlanStatus(null);
    const { data, error } = await supabase.rpc('apply_firm_promotion', { promo_code: promoCode });
    if (error) {
      setPlanStatus({ text: error.message, type: 'error' });
    } else {
      setQuote(data as FirmQuote);
      setPromoCode('');
      setPlanStatus({ text: 'Promotion applied.', type: 'success' });
    }
    setApplyingPromo(false);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);
    if (password.length < 6) {
      setPasswordStatus({ text: 'Use at least 6 characters.', type: 'error' });
      return;
    }
    if (password !== confirmPassword) {
      setPasswordStatus({ text: 'The two passwords do not match.', type: 'error' });
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPasswordStatus({ text: error.message, type: 'error' });
    } else {
      setPassword('');
      setConfirmPassword('');
      setPasswordStatus({ text: 'Password changed.', type: 'success' });
    }
    setSavingPassword(false);
  };

  const handleHeaderFile = async (file: File | undefined) => {
    setHeaderStatus(null);
    setPendingHeader(null);
    setHeaderFileName('');
    if (!file) return;
    if (file.size > 100000) {
      setHeaderStatus({ text: 'That file is too large.', type: 'error' });
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setHeaderStatus({ text: 'The file must contain a JSON object.', type: 'error' });
        return;
      }
      setPendingHeader(parsed);
      setHeaderFileName(file.name);
    } catch {
      setHeaderStatus({ text: 'That file is not valid JSON.', type: 'error' });
    }
  };

  const saveHeader = async (header: Record<string, unknown>) => {
    setSavingHeader(true);
    setHeaderStatus(null);
    const { error } = await supabase.rpc('set_report_header', { header });
    if (error) {
      setHeaderStatus({ text: error.message, type: 'error' });
    } else {
      setReportHeader(header);
      setPendingHeader(null);
      setHeaderFileName('');
      setHeaderStatus({
        text: Object.keys(header).length === 0 ? 'Reports will use the default header.' : 'Report header saved.',
        type: 'success',
      });
    }
    setSavingHeader(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="text-xs text-slate-400 mt-1">
          Your name, password, and the header used on client and advisor reports.
        </p>
      </div>

      <Card
        title="Advisor"
        subtitle="The name is printed on the right side of both reports."
      >
        <SkeletonFade loading={loading} skeleton={<AdvisorProfileSkeleton />}>
          <form onSubmit={handleUpdateProfile} className="space-y-4 mt-2">
            <div>
              <p className="text-xs font-medium text-slate-300">Account</p>
              <p className="mt-1 text-sm text-white">{accountLabel(quote, firmName)}</p>
              {quote?.plan_name && (
                <p className="mt-1 text-xs text-slate-500">
                  {portfolioLimitSentence(quote.plan_name, quote.portfolio_limit, quote.ticker_limit)}
                </p>
              )}
              {quote && quote.seats > 1 && quote.plan_code !== 'free' && quote.plan_code !== 'enterprise' && (
                <p className="mt-1 text-xs text-slate-500">
                  {quote.seats} advisor seats. The first seat is {quote.plan_code === 'pro_plus' ? '$199' : '$119'} a month and each added seat is $99.
                </p>
              )}
              {quote?.promotion && (
                <p className="mt-1 text-xs text-slate-400">
                  {quote.promotion.label} ({quote.promotion.code})
                  {quote.promotion.percent_off != null ? ` · ${quote.promotion.percent_off}% off` : ''}
                  {quote.promotion.amount_off_cents != null
                    ? ` · ${money(quote.promotion.amount_off_cents)} off`
                    : ''}
                  {quote.promotion.ends_at
                    ? ` through ${quote.promotion.ends_at.slice(0, 10)}`
                    : ''}
                </p>
              )}
              {quote?.can_manage && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {quote.plan_code === 'free' && (
                      <Button
                        type="button"
                        isLoading={planAction === 'pro'}
                        onClick={() => void handlePlan('pro')}
                      >
                        Upgrade to Pro
                      </Button>
                    )}
                    {(quote.plan_code === 'free' || quote.plan_code === 'pro') && (
                      <Button
                        type="button"
                        variant={quote.plan_code === 'free' ? 'outline' : undefined}
                        isLoading={planAction === 'pro_plus'}
                        onClick={() => void handlePlan('pro_plus')}
                      >
                        Upgrade to Pro+
                      </Button>
                    )}
                    {quote.plan_code === 'pro_plus' && (
                      <Button
                        type="button"
                        variant="outline"
                        isLoading={planAction === 'pro'}
                        onClick={() => void handlePlan('pro')}
                      >
                        Downgrade to Pro
                      </Button>
                    )}
                    {(quote.plan_code === 'pro' || quote.plan_code === 'pro_plus') && (
                      <Button
                        type="button"
                        variant="outline"
                        isLoading={planAction === 'free'}
                        onClick={() => void handlePlan('free')}
                      >
                        Downgrade to Free
                      </Button>
                    )}
                    <span className="text-xs text-slate-500">
                      Pro and Pro+ open Stripe checkout. The plan changes after Stripe confirms payment.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-48">
                      <Input
                        label="Promotion code"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (promoCode.trim()) void handlePromotion();
                          }
                        }}
                        placeholder="FOUNDING"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      isLoading={applyingPromo}
                      disabled={!promoCode.trim()}
                      onClick={() => void handlePromotion()}
                    >
                      Apply
                    </Button>
                  </div>
                  <StatusLine status={planStatus} />
                </div>
              )}
              {quote && !quote.can_manage && <StatusLine status={planStatus} />}
            </div>
            <Input
              label="Full Name"
              placeholder="e.g. Sarah Jenkins"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="pt-2 flex items-center justify-between">
              <Button type="submit" isLoading={savingName}>
                Save name
              </Button>
              <StatusLine status={nameStatus} />
            </div>
          </form>
        </SkeletonFade>
      </Card>

      <Card title="Password" subtitle="Choose a new password for this account.">
        <form onSubmit={handlePassword} className="space-y-4">
          <Input
            label="New password"
            type="password"
            reveal
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Input
            label="Confirm password"
            type="password"
            reveal
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat the new password"
          />
          <div className="pt-2 flex items-center justify-between">
            <Button type="submit" isLoading={savingPassword}>
              Change password
            </Button>
            <StatusLine status={passwordStatus} />
          </div>
        </form>
      </Card>

      <AuthenticatorCard />

      <Card
        title="Report header"
        subtitle="Upload the firm JSON for colors, logo, date, and report id."
      >
        <SkeletonFade loading={loading} skeleton={<ReportHeaderSkeleton />}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{headerLabel(reportHeader)}</p>
            <p className="text-xs text-slate-500">
              Firm name, advisor name, and the report title still come from the account. The title, date, and id inside the file are stored and not printed.
            </p>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Header file
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  void handleHeaderFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
                className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
              />
            </label>
            {headerFileName && (
              <p className="text-xs text-slate-400">Ready to save {headerFileName}</p>
            )}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                isLoading={savingHeader}
                disabled={!pendingHeader}
                onClick={() => pendingHeader && void saveHeader(pendingHeader)}
              >
                Save header
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingHeader || !reportHeader || Object.keys(reportHeader).length === 0}
                onClick={() => void saveHeader({})}
              >
                Use default header
              </Button>
              <StatusLine status={headerStatus} />
            </div>
          </div>
        </SkeletonFade>
      </Card>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <span className={`text-xs font-semibold ${status.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
      {status.text}
    </span>
  );
}
