'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { pathAfterSignIn } from '@/lib/oauth';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const params = new URLSearchParams(window.location.search);
      const described = params.get('error_description') || params.get('error');
      if (described) {
        if (!cancelled) setError(described);
        return;
      }

      const code = params.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (!cancelled) setError(exchangeError.message);
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) setError('Sign-in did not complete. Try again.');
        return;
      }
      router.replace(await pathAfterSignIn());
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <p className="text-sm text-slate-300">{error ? error : 'Signing in...'}</p>
    </main>
  );
}
