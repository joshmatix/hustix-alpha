'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AgreementBody from '@/components/auth/AgreementBody';
import AgreementScroll from '@/components/auth/AgreementScroll';
import { acceptAgreement, fetchAgreement, hasAcceptedCurrentAgreement, type AgreementDocument } from '@/lib/agreement';
import { pathAfterSignIn } from '@/lib/oauth';
import { supabase } from '@/lib/supabaseClient';

export default function AcceptAgreementPage() {
  const router = useRouter();
  const [agreement, setAgreement] = useState<AgreementDocument | null>(null);
  const [firstAcceptance, setFirstAcceptance] = useState(true);
  const [read, setRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) router.replace('/login');
        return;
      }
      if (await hasAcceptedCurrentAgreement()) {
        if (!cancelled) router.replace(await pathAfterSignIn());
        return;
      }
      const { count } = await supabase
        .from('agreement_acceptances')
        .select('id', { count: 'exact', head: true });
      const document = await fetchAgreement();
      if (cancelled) return;
      if (!document) {
        setError('The agreement could not be loaded.');
        setLoading(false);
        return;
      }
      setFirstAcceptance(count === 0);
      setAgreement(document);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleAccept = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agreement || !read || !agreed) return;
    setSaving(true);
    setError(null);
    const acceptanceError = await acceptAgreement(agreement.version);
    if (acceptanceError) {
      setError(acceptanceError);
      setSaving(false);
      return;
    }
    router.replace(await pathAfterSignIn());
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {firstAcceptance ? 'Customer agreement' : 'Updated agreement'}
          </h1>
          <p className="text-xs text-slate-400">
            {firstAcceptance
              ? 'Accept the agreement to finish signing in.'
              : 'Accept the current version to open the dashboard.'}
          </p>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={(event) => void handleAccept(event)} className="mt-6 space-y-5">
          <AgreementScroll
            active={agreement !== null}
            read={read}
            onRead={() => setRead(true)}
            className="max-h-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3"
          >
            {agreement ? (
              <AgreementBody agreement={agreement} />
            ) : (
              <p className="text-xs text-slate-400">{loading ? 'Loading the agreement...' : 'The agreement could not be loaded.'}</p>
            )}
          </AgreementScroll>

          <label className={`flex items-start gap-3 text-xs leading-relaxed ${read ? 'text-slate-300' : 'text-slate-500'}`}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => {
                if (read) setAgreed(event.target.checked);
              }}
              disabled={!agreement || !read || saving}
              required
              className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
            />
            <span>
              I have read and agree to the {agreement ? `${agreement.title} (version ${agreement.version})` : 'current agreement'}.
            </span>
          </label>

          <button
            type="submit"
            disabled={!agreement || !read || !agreed || saving}
            className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:bg-indigo-600/50"
          >
            {saving ? 'Saving...' : 'I agree'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 w-full text-center text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
