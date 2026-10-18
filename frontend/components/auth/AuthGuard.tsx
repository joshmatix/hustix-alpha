'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { ensureProfile } from '@/lib/ensureProfile';
import { authenticatorStillRequired, hasVerifiedAuthenticator } from '@/lib/mfa';

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'hustix_last_activity';
const IDLE_NOTICE_KEY = 'hustix_idle_signout';

function lastActivity() {
  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

function idleExpired() {
  const stored = lastActivity();
  return stored > 0 && Date.now() - stored >= IDLE_LIMIT_MS;
}

async function signOutForInactivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  sessionStorage.setItem(IDLE_NOTICE_KEY, '1');
  await supabase.auth.signOut();
}

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || (await authenticatorStillRequired())) {
        router.push('/login');
      } else if (!(await hasVerifiedAuthenticator())) {
        router.push('/signup');
      } else {
        await ensureProfile(session.user.id);
        setAuthenticated(true);
      }
      setLoading(false);
    }

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setAuthenticated(false);
        router.push('/login');
        return;
      }
      void authenticatorStillRequired().then(async (needsCode) => {
        if (needsCode) {
          setAuthenticated(false);
          router.push('/login');
          return;
        }
        if (!(await hasVerifiedAuthenticator())) {
          setAuthenticated(false);
          router.push('/signup');
          return;
        }
        void ensureProfile(session.user.id);
        setAuthenticated(true);
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;

    if (idleExpired()) {
      void signOutForInactivity();
      return;
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
