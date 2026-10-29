/** Idle timeout and session timing shared by AuthGuard and the header badge. */

export const IDLE_LIMIT_MS = 15 * 60 * 1000;
export const WARN_REMAINING_MS = 5 * 60 * 1000;
export const LAST_ACTIVITY_KEY = 'hustix_last_activity';
export const ACTIVITY_SESSION_KEY = 'hustix_activity_session';
export const SESSION_STARTED_KEY = 'hustix_session_started';
export const IDLE_NOTICE_KEY = 'hustix_idle_signout';

export function lastActivity(): number {
  if (typeof localStorage === 'undefined') return 0;
  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

export function sessionStartedAt(): number {
  if (typeof localStorage === 'undefined') return 0;
  const stored = Number(localStorage.getItem(SESSION_STARTED_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

export function idleExpired(now = Date.now()): boolean {
  const stored = lastActivity();
  return stored > 0 && now - stored >= IDLE_LIMIT_MS;
}

export function readSessionId(accessToken: string): string {
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

/** A new sign-in gets a fresh idle window and session-start clock. */
export function noteSession(accessToken: string): void {
  if (typeof localStorage === 'undefined') return;
  const current = readSessionId(accessToken);
  const stored = localStorage.getItem(ACTIVITY_SESSION_KEY) || '';
  if (!current || current !== stored) {
    const now = String(Date.now());
    localStorage.setItem(LAST_ACTIVITY_KEY, now);
    localStorage.setItem(SESSION_STARTED_KEY, now);
    if (current) localStorage.setItem(ACTIVITY_SESSION_KEY, current);
    return;
  }
  // Same session from before SESSION_STARTED_KEY existed.
  if (!localStorage.getItem(SESSION_STARTED_KEY)) {
    const activity = localStorage.getItem(LAST_ACTIVITY_KEY);
    localStorage.setItem(SESSION_STARTED_KEY, activity || String(Date.now()));
  }
}

export function clearSessionIdle(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  localStorage.removeItem(ACTIVITY_SESSION_KEY);
  localStorage.removeItem(SESSION_STARTED_KEY);
}

export function markActivity(now = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

export type SessionTiming = {
  activeMs: number;
  remainingMs: number;
  warn: boolean;
};

export function readSessionTiming(now = Date.now()): SessionTiming {
  const started = sessionStartedAt();
  const activity = lastActivity();
  const activeMs = started > 0 ? Math.max(0, now - started) : 0;
  const remainingMs =
    activity > 0 ? Math.max(0, IDLE_LIMIT_MS - (now - activity)) : IDLE_LIMIT_MS;
  return {
    activeMs,
    remainingMs,
    warn: remainingMs > 0 && remainingMs <= WARN_REMAINING_MS,
  };
}

/** Compact duration for the header badge: `12m`, `1h 05m`. */
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m`;
}
