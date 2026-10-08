'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Header() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    getUser();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/signup');
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-10">
      {/* Quick Macro Ticker / Indicator */}
      <div className="flex items-center gap-4 text-xs">
        <div className="bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-md flex items-center gap-2">
          <span className="text-slate-400">US 10Y Yield:</span>
          <span className="text-indigo-400 font-semibold">4.22%</span>
        </div>
        <div className="bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-md flex items-center gap-2">
          <span className="text-slate-400">Fed Funds Rate:</span>
          <span className="text-emerald-400 font-semibold">5.25%</span>
        </div>
      </div>

      {/* User Actions */}
      <div className="flex items-center gap-4">
        {userEmail && (
          <span className="text-xs text-slate-300 font-medium bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
            {userEmail}
          </span>
        )}
        <button
          onClick={handleSignOut}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-800 px-3 py-1.5 rounded-lg font-medium transition"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}