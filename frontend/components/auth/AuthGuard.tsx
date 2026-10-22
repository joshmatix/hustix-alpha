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

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'hustix_last_activity';
const ACTIVITY_SESSION_KEY = 'hustix_activity_session';
const IDLE_NOTICE_KEY = 'hustix_idle_signout';

function lastActivity() {
  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

function idleExpired() {
  const stored = lastActivity();
  return stored > 0 && Date.now() - stored >= IDLE_LIMIT_MS;
}

function readSessionId(accessToken: string) {
  const part = accessToken.split('.')[1];
  if (!part) return '';
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof payload.session_id === 'string' ? payload.session_id : '';
  } catch {
    return '';
  }
}

/** A new sign-in gets a fresh 15 minutes. An older timestamp belongs to the previous visit. */
function noteSession(session: Session) {
  const current = readSessionId(session.access_token);
  const stored = localStorage.getItem(ACTIVITY_SESSION_KEY) || '';
  if (!current || current !== stored) {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    if (current) localStorage.setItem(ACTIVITY_SESSION_KEY, current);
  }
}

async function signOutForInactivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  localStorage.removeItem(ACTIVITY_SESSION_KEY);
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
              noteSession(session);
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

        if (!session || (await authenticatorStillRequired())) {
          router.push('/login');
        } else if (await accountIsDisabled()) {
          await supabase.auth.signOut();
          router.push('/login?disabled=1');
        } else if (!(await hasAcceptedCurrentAgreement())) {
          router.push('/agreement/accept');
        } else if (!(await hasVerifiedAuthenticator())) {
          router.push('/signup');
        } else {
          noteSession(session);
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
            router.push('/login');
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
          noteSession(session);
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
        localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      } else {
        void signOutForInactivity();
        return;
      }
    }

    let lastWrite = lastActivity();
    const markActive = () => {
      const now = Date.now();
      if (now - lastWrite < 10_000) return;
      lastWrite = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    };
    markActive();

    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
    events.forEach((name) => window.addEventListener(name, markActive, { passive: true }));

    const checkIdle = () => {
      if (idleExpired()) void signOutForInactivity();
    };
    const timer = window.setInterval(checkIdle, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      events.forEach((name) => window.removeEventListener(name, markActive));
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
