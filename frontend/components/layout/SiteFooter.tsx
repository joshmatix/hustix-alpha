'use client';

import { usePathname } from 'next/navigation';
import { SUPPORT_EMAIL } from '@/lib/support';

export function SupportLine() {
  return (
    <p className="text-xs text-slate-500">
      Support{' '}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-300 hover:text-indigo-200">
        {SUPPORT_EMAIL}
      </a>
    </p>
  );
}

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/') return null;

  return (
    <footer className="border-t border-slate-900 px-6 py-4 text-center">
      <SupportLine />
    </footer>
  );
}
