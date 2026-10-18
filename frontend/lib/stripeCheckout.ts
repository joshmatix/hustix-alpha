'use server';

import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

type PaidPlan = 'pro' | 'pro_plus';

const PRICE_ENV: Record<PaidPlan, string> = {
  pro: 'STRIPE_PRICE_PRO',
  pro_plus: 'STRIPE_PRICE_PRO_PLUS',
};

export type CheckoutResult = { url: string } | { error: string };

function siteOrigin() {
  const headerStore = headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  if (!host) return null;
  const proto = headerStore.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  return `${proto}://${host}`;
}

function priceId(plan: PaidPlan) {
  const value = process.env[PRICE_ENV[plan]]?.trim();
  return value || null;
}

export async function createCheckoutSession(plan: PaidPlan, accessToken: string): Promise<CheckoutResult> {
  if (plan !== 'pro' && plan !== 'pro_plus') {
    return { error: 'Choose Pro or Pro+.' };
  }
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const price = priceId(plan);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!secret || !price) {
    return { error: 'Stripe checkout is not configured.' };
  }
  if (!supabaseUrl || !anonKey || !accessToken) {
    return { error: 'Sign in again before changing the plan.' };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  const user = userData.user;
  if (userError || !user) {
    return { error: 'Sign in again before changing the plan.' };
  }

  const { data: membership, error: memberError } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (memberError || !membership?.firm_id) {
    return { error: 'Only a firm owner can change the plan.' };
  }

  const origin = siteOrigin();
  if (!origin) {
    return { error: 'Could not open checkout.' };
  }

  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: membership.firm_id,
    customer_email: user.email ?? undefined,
    line_items: [{ price, quantity: 1 }],
    metadata: { firm_id: membership.firm_id, plan },
    subscription_data: { metadata: { firm_id: membership.firm_id, plan } },
    success_url: `${origin}/dashboard/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/settings?checkout=cancel`,
  });
  if (!session.url) {
    return { error: 'Stripe did not return a checkout page.' };
  }
  return { url: session.url };
}
