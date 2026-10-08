'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setEmail(user.email);
      }
    }
    fetchUser();

    // Close dropdown on outside click
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/signup');
  };

  if (!email) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-full text-xs transition"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-slate-200 font-medium">{email}</span>
        <span className="text-slate-400 text-[10px]">▼</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-xl py-2 z-50 text-xs">
          <div className="px-4 py-2 border-b border-slate-800">
            <p className="text-[10px] uppercase text-slate-400 font-semibold">Signed in as</p>
            <p className="text-slate-200 truncate font-medium mt-0.5">{email}</p>
          </div>

          <Link
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            ⚙️ Profile & Settings
          </Link>

          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2 text-rose-400 hover:bg-slate-800 transition font-medium"
          >
            🚪 Sign Out
          </button>
        </div>
      )}
    </div>
  );
}