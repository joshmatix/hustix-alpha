import { supabase } from '@/lib/supabaseClient';

/** True when this account already has an authenticator app. */
export async function hasVerifiedAuthenticator() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return false;
  return data.totp.length > 0;
}

/** True when this session still needs a code from an authenticator app. */
export async function authenticatorStillRequired() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel !== 'aal2' && data.nextLevel === 'aal2';
}

export type AuthenticatorSetup = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export type EnrollmentResult =
  | { ok: true; setup: AuthenticatorSetup }
  | { ok: false; alreadyVerified: true }
  | { ok: false; alreadyVerified?: false; message: string };

let enrollmentInFlight: Promise<EnrollmentResult> | null = null;

/** One enrollment at a time. A second call while the first is running shares its result. */
export function beginAuthenticatorEnrollment() {
  if (!enrollmentInFlight) {
    enrollmentInFlight = enrollAuthenticator().finally(() => {
      enrollmentInFlight = null;
    });
  }
  return enrollmentInFlight;
}

async function enrollAuthenticator(): Promise<EnrollmentResult> {
  const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError || !existing) {
    return { ok: false, message: listError?.message || 'Could not read authenticator setup.' };
  }
  if (existing.totp.length > 0) {
    return { ok: false, alreadyVerified: true };
  }

  for (const factor of existing.all) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator app',
  });
  if (error || !data || data.type !== 'totp') {
    return { ok: false, message: error?.message || 'Could not start authenticator setup.' };
  }
  return {
    ok: true,
    setup: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
  };
}

export function qrCodeSrc(qrCode: string) {
  if (qrCode.startsWith('data:')) return qrCode;
  if (qrCode.trim().startsWith('<svg')) {
    return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
  }
  return `data:image/svg+xml;utf-8,${qrCode}`;
}
