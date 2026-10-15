import { supabase } from '@/lib/supabaseClient';

export type AccountPlan = 'free' | 'pro' | 'pro_plus';

export async function ensureProfile(userId: string) {
  const { error } = await supabase.from('profiles').upsert(
    { id: userId },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  return error;
}
