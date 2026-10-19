'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function SiteFooter() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setEmail(null);
        return;
      }
      const response = await fetch('/api/support/contact', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        if (!cancelled) setEmail(null);
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!cancelled) {
        setEmail(typeof body.email === 'string' && body.email ? body.email : null);
      }
    }

    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        void load();
      }, 0);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (pathname === '/login' || pathname === '/' || pathname === '/auth/callback') return null;

  return (
    <footer className="border-t border-slate-900 px-6 py-4 text-center">
      <p className="text-xs text-slate-500">
        <Link href="/agreement" className="text-indigo-300 hover:text-indigo-200">
          Customer Agreement
        </Link>
        <span className="px-2">·</span>
        <Link href="/privacy" className="text-indigo-300 hover:text-indigo-200">
          Privacy Policy
        </Link>
        <span className="px-2">·</span>
        <Link href="/terms" className="text-indigo-300 hover:text-indigo-200">
          Terms of Service
        </Link>
        {email ? (
          <>
            <span className="px-2">·</span>
            Support{' '}
            <a href={`mailto:${email}`} className="text-indigo-300 hover:text-indigo-200">
              {email}
            </a>
          </>
        ) : null}
      </p>
    </footer>
  );
}
