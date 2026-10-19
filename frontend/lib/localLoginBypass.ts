import { supabase } from '@/lib/supabaseClient';

export function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

const STAND_IN_EMAIL = 'joshmatix@yahoo.com';

let pendingBypass: Promise<boolean> | null = null;

async function existingStandInSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.email?.toLowerCase() === STAND_IN_EMAIL;
}

async function runLocalLoginBypass() {
  if (await existingStandInSession()) return true;
  const response = await fetch('/api/local-bypass', { cache: 'no-store' });
  if (!response.ok) return false;
  const body = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) return false;
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  return !error;
}

/** Signs in the local stand-in user when the bypass file is present. */
export function tryLocalLoginBypass(options?: { ignoreHost?: boolean }) {
  if (!options?.ignoreHost && !isLocalHost()) return Promise.resolve(false);
  if (!pendingBypass) {
    pendingBypass = runLocalLoginBypass().finally(() => {
      pendingBypass = null;
    });
  }
  return pendingBypass;
}
