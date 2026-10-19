'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ensureProfile } from '@/lib/ensureProfile';
import { tryLocalLoginBypass } from '@/lib/localLoginBypass';

/** Attaches the stand-in session without replacing the dashboard. */
export default function LocalBypassSession() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bypassed = await tryLocalLoginBypass({ ignoreHost: true });
      if (cancelled || !bypassed) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) void ensureProfile(session.user.id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
