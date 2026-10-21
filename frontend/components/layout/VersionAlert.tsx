'use client';

import { useCallback, useEffect, useState } from 'react';

const DISMISS_KEY = 'hustix-version-dismissed';
const POLL_MS = 60_000;
const runningId = process.env.NEXT_PUBLIC_DEPLOYMENT_ID || 'local';

function dismissedId() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
}

export default function VersionAlert({ className = '' }: { className?: string }) {
  const [latestId, setLatestId] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/version', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { id?: unknown };
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!id || id === runningId || dismissedId() === id) {
        setLatestId(null);
        return;
      }
      setLatestId(id);
    } catch {
      /* leave the current banner in place if this check fails */
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onDismissed = () => setLatestId(null);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hustix-version-dismiss', onDismissed);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hustix-version-dismiss', onDismissed);
    };
  }, [check]);

  if (!latestId) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, latestId);
    } catch {
      /* session dismiss is best-effort */
    }
    setLatestId(null);
    window.dispatchEvent(new Event('hustix-version-dismiss'));
  }

  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 text-xs ${className}`}>
      <span className="sr-only">A new version is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500"
      >
        New Version
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="text-slate-400 transition hover:text-slate-200"
      >
        Dismiss
      </button>
    </div>
  );
}
