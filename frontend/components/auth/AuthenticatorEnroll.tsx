'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { authenticatorDigits, beginAuthenticatorEnrollment, qrCodeSrc, type AuthenticatorSetup } from '@/lib/mfa';

export default function AuthenticatorEnroll({ onVerified }: { onVerified: () => void }) {
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeLock = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setBusy(true);
      const result = await beginAuthenticatorEnrollment();
      if (cancelled) return;
      setBusy(false);
      if (result.status === 'ready') {
        setSetup(result.setup);
        return;
      }
      if (result.status === 'verified') {
        onVerified();
        return;
      }
      setError(result.message);
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  async function verifyCode(raw: string) {
    const next = authenticatorDigits(raw);
    if (!setup || next.length !== 6 || codeLock.current) return;
    codeLock.current = true;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: setup.factorId,
      code: next,
    });
    if (verifyError) {
      setError(verifyError.message);
      setCode('');
      setBusy(false);
      codeLock.current = false;
      return;
    }
    onVerified();
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    void verifyCode(code);
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className="text-sm text-slate-300">
        Scan this code with an authenticator app, then enter the 6-digit code it shows. A valid code continues on its own. This step is required to finish creating the account.
      </p>
      {setup ? (
        <>
          <img
            src={qrCodeSrc(setup.qrCode)}
            alt="Authenticator setup code"
            className="h-40 w-40 rounded-lg bg-white p-2"
          />
          <p className="text-xs text-slate-400">
            If you cannot scan it, enter this secret in the app:{' '}
            <span className="font-mono text-slate-200">{setup.secret}</span>
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-400">{error ? '' : 'Preparing the authenticator code...'}</p>
      )}
      <div className="flex flex-col">
        <label className="mb-2 block text-xs font-medium leading-none text-slate-300" htmlFor="enroll-code">
          Authenticator code
        </label>
        <input
          id="enroll-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={6}
          value={code}
          onChange={(event) => {
            const next = authenticatorDigits(event.target.value);
            setCode(next);
            if (next.length === 6) void verifyCode(next);
          }}
          className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          placeholder="123456"
        />
      </div>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !setup}
        className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white disabled:bg-indigo-600/50"
      >
        {busy ? 'Checking code...' : 'Finish account'}
      </button>
    </form>
  );
}
