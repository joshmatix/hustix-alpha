import { supabase } from '@/lib/supabaseClient';
import { authenticatorStillRequired, hasVerifiedAuthenticator } from '@/lib/mfa';

export type OAuthProvider = 'google' | 'azure';

export async function startOAuth(provider: OAuthProvider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      skipBrowserRedirect: true,
      scopes: provider === 'azure' ? 'email openid profile' : undefined,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });
  if (error) return error;
  if (!data.url) return { message: 'Sign-in did not start.' };

  const probe = await fetch(data.url, { method: 'GET', redirect: 'manual' });
  if (probe.status >= 400) {
    const body = await probe.json().catch(() => ({}));
    const message = typeof body.msg === 'string' ? body.msg : 'Sign-in did not start.';
    return { message };
  }

  window.location.assign(data.url);
  return null;
}

export function oauthErrorMessage(message: string, provider: OAuthProvider) {
  const name = provider === 'google' ? 'Google' : 'Microsoft';
  if (/not enabled|unsupported provider|provider is not enabled/i.test(message)) {
    return `${name} sign-in is not turned on for this project yet.`;
  }
  return message;
}

/** Where a signed-in user should go after email, Google, or Microsoft sign-in. */
export async function pathAfterSignIn() {
  if (await authenticatorStillRequired()) return '/login';
  if (!(await hasVerifiedAuthenticator())) return '/signup';
  return '/dashboard';
}
