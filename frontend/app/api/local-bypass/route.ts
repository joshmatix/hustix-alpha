import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { LOCAL_STAND_IN_EMAIL, localLoginBypassEnabled } from '@/lib/localBypassFlag';

export const dynamic = 'force-dynamic';

const STAND_IN_EMAIL = LOCAL_STAND_IN_EMAIL;

function requestHost(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return forwarded.split(',')[0]?.trim().split(':')[0]?.toLowerCase() ?? '';
}

/** Localhost, or an ngrok tunnel while the bypass flag is on. */
function allowedHost(request: NextRequest) {
  const host = requestHost(request);
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return (
    host.endsWith('.ngrok-free.app') ||
    host.endsWith('.ngrok-free.dev') ||
    host.endsWith('.ngrok.app') ||
    host.endsWith('.ngrok.dev') ||
    host.endsWith('.ngrok.io')
  );
}

function readEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const splitAt = line.indexOf('=');
    const key = line.slice(0, splitAt).trim();
    let value = line.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export async function GET(request: NextRequest) {
  if (!allowedHost(request) || !localLoginBypassEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendEnv = readEnvFile(path.resolve(process.cwd(), '../backend/.env'));
  const serviceKey = backendEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return NextResponse.json({ message: 'Local bypass is not configured.' }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: STAND_IN_EMAIL,
  });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash || link.data.properties?.verification_type !== 'magiclink') {
    return NextResponse.json({ message: 'Local stand-in session did not start.' }, { status: 503 });
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  const accessToken = verified.data.session?.access_token;
  const refreshToken = verified.data.session?.refresh_token;
  if (verified.error || !accessToken || !refreshToken) {
    return NextResponse.json({ message: 'Local stand-in session did not start.' }, { status: 503 });
  }

  return NextResponse.json({ access_token: accessToken, refresh_token: refreshToken });
}
