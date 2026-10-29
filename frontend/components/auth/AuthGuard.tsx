'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { ensureProfile } from '@/lib/ensureProfile';
import { hasAcceptedCurrentAgreement } from '@/lib/agreement';
import { accountIsDisabled } from '@/lib/oauth';
import { isLocalHost, tryLocalLoginBypass } from '@/lib/localLoginBypass';
import { authenticatorStillRequired, hasVerifiedAuthenticator } from '@/lib/mfa';
import {
  IDLE_NOTICE_KEY,
  clearSessionIdle,
  idleExpired,
  lastActivity,
  markActivity,
  noteSession,
} from '@/lib/sessionIdle';

function noteAuthSession(session: Session) {
  noteSession(session.access_token);
}

async function signOutForInactivity() {
  clearSessionIdle();
  sessionStorage.setItem(IDLE_NOTICE_KEY, '1');
  await supabase.auth.signOut();
}

interface AuthGuardProps {
  children: React.ReactNode;
  /** Server already confirmed the local bypass flag. Render the dashboard immediately. */
  bypass?: boolean;
}

export default function AuthGuard({ children, bypass = false }: AuthGuardProps) {
  const router = useRouter();
  const bypassRef = useRef(bypass || false);
  const [authenticated, setAuthenticated] = useState(bypass);
  const [loading, setLoading] = useState(!bypass);

  useEffect(() => {
    let cancelled = false;
    if (bypass || isLocalHost()) bypassRef.current = true;

    async function checkAuth() {
      try {
        if (bypass || isLocalHost()) {
          const bypassed = await tryLocalLoginBypass({ ignoreHost: bypass });
          if (cancelled) return;
          if (bypassed) {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (session) {
              noteAuthSession(session);
              if (await accountIsDisabled()) {
                setAuthenticated(false);
                await supabase.auth.signOut();
                router.push('/login?disabled=1');
                return;
              }
              if (!(await hasAcceptedCurrentAgreement())) {
                setAuthenticated(false);
                router.push('/agreement/accept');
                return;
              }
              setAuthenticated(true);
              void ensureProfile(session.user.id);
              return;
            }
          }
          if (!bypass) bypassRef.current = false;
          if (bypass) return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!session) {
          router.push('/login');
        } else if (await authenticatorStillRequired()) {
          router.push('/login?mfa=1');
        } else if (await accountIsDisabled()) {
          await supabase.auth.signOut();
          router.push('/login?disabled=1');
        } else if (!(await hasAcceptedCurrentAgreement())) {
          router.push('/agreement/accept');
        } else if (!(await hasVerifiedAuthenticator())) {
          router.push('/signup');
        } else {
          noteAuthSession(session);
          void ensureProfile(session.user.id);
          setAuthenticated(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Leave the auth lock before touching the session again.
      window.setTimeout(() => {
        if (cancelled || bypassRef.current) return;
        if (event === 'SIGNED_OUT' || !session) {
          setAuthenticated(false);
          router.push('/login');
          return;
        }
        void authenticatorStillRequired().then(async (needsCode) => {
          if (cancelled || bypassRef.current) return;
          if (needsCode) {
            setAuthenticated(false);
            router.push('/login?mfa=1');
            return;
          }
          if (await accountIsDisabled()) {
            setAuthenticated(false);
            await supabase.auth.signOut();
            router.push('/login?disabled=1');
            return;
          }
          if (!(await hasAcceptedCurrentAgreement())) {
            setAuthenticated(false);
            router.push('/agreement/accept');
            return;
          }
          if (!(await hasVerifiedAuthenticator())) {
            setAuthenticated(false);
            router.push('/signup');
            return;
          }
          noteAuthSession(session);
          void ensureProfile(session.user.id);
          setAuthenticated(true);
          setLoading(false);
        });
      }, 0);
    });

    void checkAuth();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [bypass, router]);

  useEffect(() => {
    if (!authenticated) return;

    if (idleExpired()) {
      if (bypassRef.current) {
        markActivity();
      } else {
        void signOutForInactivity();
        return;
      }
    }

    let lastWrite = lastActivity();
    const onActive = () => {
      const now = Date.now();
      if (now - lastWrite < 10_000) return;
      lastWrite = now;
      markActivity(now);
    };
    onActive();

    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
    events.forEach((name) => window.addEventListener(name, onActive, { passive: true }));

    const checkIdle = () => {
      if (idleExpired()) void signOutForInactivity();
    };
    const timer = window.setInterval(checkIdle, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      events.forEach((name) => window.removeEventListener(name, onActive));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-slate-400">Verifying security session...</span>
        </div>
      </div>
    );
  }

  return authenticated ? <>{children}</> : null;
}
