import type { OAuthProvider } from '@/lib/oauth';

/** Flip to true when Google / Microsoft sign-in should show again. */
const OAUTH_BUTTONS_ENABLED = false;

export function OAuthButtons({
  disabled,
  onProvider,
}: {
  disabled?: boolean;
  onProvider: (provider: OAuthProvider) => void;
}) {
  if (!OAUTH_BUTTONS_ENABLED) return null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onProvider('google')}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-950 py-3 text-sm font-medium text-white transition hover:border-slate-500 disabled:opacity-60"
      >
        <GoogleMark />
        Continue with Google
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onProvider('azure')}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-950 py-3 text-sm font-medium text-white transition hover:border-slate-500 disabled:opacity-60"
      >
        <MicrosoftMark />
        Continue with Microsoft
      </button>
      <div className="flex items-center gap-3 pt-1 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        or
        <span className="h-px flex-1 bg-slate-800" />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#F25022" d="M1 1h6.5v6.5H1z" />
      <path fill="#7FBA00" d="M8.5 1H15v6.5H8.5z" />
      <path fill="#00A4EF" d="M1 8.5h6.5V15H1z" />
      <path fill="#FFB900" d="M8.5 8.5H15V15H8.5z" />
    </svg>
  );
}
