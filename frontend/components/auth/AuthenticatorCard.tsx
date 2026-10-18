'use client';

import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { beginAuthenticatorEnrollment, qrCodeSrc } from '@/lib/mfa';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

type Status = { text: string; type: 'success' | 'error' } | null;

type Setup = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export default function AuthenticatorCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>(null);

  async function load() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setStatus({ text: error.message, type: 'error' });
      setFactorId(null);
    } else {
      setFactorId(data.totp[0]?.id ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function startSetup() {
    setBusy(true);
    setStatus(null);
    const result = await beginAuthenticatorEnrollment();
    setBusy(false);
    if (result.ok) {
      setSetup(result.setup);
      return;
    }
    if (result.alreadyVerified) {
      setStatus({ text: 'An authenticator app is already on for this account.', type: 'success' });
      void load();
      return;
    }
    setStatus({ text: result.message, type: 'error' });
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    if (!setup) return;
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: setup.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      setStatus({ text: error.message, type: 'error' });
      return;
    }
    setSetup(null);
    setCode('');
    setFactorId(setup.factorId);
    setStatus({ text: 'Authenticator app is on. Sign-in will ask for a code.', type: 'success' });
  }

  async function cancelSetup() {
    if (!setup) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: setup.factorId });
    setSetup(null);
    setCode('');
    setBusy(false);
  }

  return (
    <Card title="Authenticator app" subtitle="Every account uses an authenticator app at sign-in.">
      {loading ? (
        <p className="text-sm text-slate-400">Loading authenticator...</p>
      ) : setup ? (
        <form onSubmit={confirmSetup} className="space-y-4">
          <p className="text-sm text-slate-300">
            Scan this code with an authenticator app, then enter the 6-digit code it shows.
          </p>
          <img
            src={qrCodeSrc(setup.qrCode)}
            alt="Authenticator setup code"
            className="h-40 w-40 rounded-lg bg-white p-2"
          />
          <p className="text-xs text-slate-400">
            If you cannot scan it, enter this secret in the app:{' '}
            <span className="font-mono text-slate-200">{setup.secret}</span>
          </p>
          <Input
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" isLoading={busy}>
              Confirm code
            </Button>
            <Button type="button" variant="outline" onClick={() => void cancelSetup()} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : factorId ? (
        <p className="text-sm text-slate-300">An authenticator app is required at sign-in.</p>
      ) : (
        <Button type="button" isLoading={busy} onClick={() => void startSetup()}>
          Set up authenticator app
        </Button>
      )}
      {status ? (
        <p className={`mt-3 text-sm ${status.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {status.text}
        </p>
      ) : null}
    </Card>
  );
}
