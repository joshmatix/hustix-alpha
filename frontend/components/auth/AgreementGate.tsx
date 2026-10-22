'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { hasAcceptedCurrentAgreement } from '@/lib/agreement';
import { accountIsDisabled } from '@/lib/oauth';
import { supabase } from '@/lib/supabaseClient';

/** Holds the dashboard until the latest acceptance matches the current agreement. */
export default function AgreementGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const evaluate = async (session: Session | null) => {
      if (!session) return;
      if (await accountIsDisabled()) {
        await supabase.auth.signOut();
        if (!cancelled) router.replace('/login?disabled=1');
        return;
      }
      if (!(await hasAcceptedCurrentAgreement())) {
        if (!cancelled) router.replace('/agreement/accept');
        return;
      }
      if (!cancelled) setOpen(true);
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) void evaluate(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) void evaluate(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  if (!open) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="text-sm font-medium text-slate-400">Checking the agreement...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
