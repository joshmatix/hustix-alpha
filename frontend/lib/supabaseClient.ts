import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Auth will fail until it is provided in .env.local.');
}

/** A refresh in this tab keeps the sign-in. Closing the tab drops it, so the next visit starts signed out. */
const tabSessionStorage: SupportedStorage = {
  getItem: (key) => (typeof window === 'undefined' ? null : window.sessionStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
  },
};

function dropPersistedSignIn() {
  if (typeof window === 'undefined') return;
  const leftover: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith('sb-') && key.includes('auth-token')) leftover.push(key);
  }
  leftover.forEach((key) => window.localStorage.removeItem(key));
}

dropPersistedSignIn();

export const supabase = createClient(supabaseUrl, supabaseAnonKey || 'missing-anon-key', {
  auth: {
    storage: tabSessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
