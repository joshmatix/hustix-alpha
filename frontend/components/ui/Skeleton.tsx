'use client';

import { useEffect, useState, type ReactNode } from 'react';

function Bar({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-shimmer rounded-md bg-gradient-to-r from-slate-800 via-slate-600 to-slate-800 bg-[length:200%_100%] ${className}`}
    />
  );
}

/** Crossfades a skeleton into the loaded content. */
export function SkeletonFade({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  const [showSkeleton, setShowSkeleton] = useState(loading);
  const [visible, setVisible] = useState(!loading);

  useEffect(() => {
    if (loading) {
      setShowSkeleton(true);
      setVisible(false);
      return;
    }
    const frame = requestAnimationFrame(() => setVisible(true));
    const timer = window.setTimeout(() => setShowSkeleton(false), 300);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [loading]);

  return (
    <div className="grid">
      {showSkeleton ? (
        <div
          className={`col-start-1 row-start-1 transition-opacity duration-300 ${
            loading ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {skeleton}
        </div>
      ) : null}
      {loading ? null : (
        <div className={`col-start-1 row-start-1 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
          {children}
        </div>
      )}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading portfolios">
      <div className="max-w-xs">
        <Bar className="h-3 w-12" />
        <Bar className="mt-1 h-10 w-full rounded-md" />
      </div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <Bar className="h-6 w-56" />
          <Bar className="h-6 w-20 rounded-full" />
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/50 text-xs">
            <tr>
              <th className="w-12 px-4 py-3.5"><Bar className="h-4 w-4" /></th>
              <th className="px-6 py-3.5"><Bar className="h-4 w-20" /></th>
              <th className="px-6 py-3.5"><Bar className="h-4 w-24" /></th>
              <th className="px-6 py-3.5"><Bar className="h-4 w-28" /></th>
              <th className="px-6 py-3.5 text-right"><Bar className="ml-auto h-4 w-14" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {Array.from({ length: 3 }, (_, index) => (
              <tr key={index}>
                <td className="px-4 py-4"><Bar className="h-4 w-4" /></td>
                <td className="px-6 py-4"><Bar className="h-5 w-28" /></td>
                <td className="px-6 py-4"><Bar className="h-5 w-24" /></td>
                <td className="px-6 py-4"><Bar className="h-4 w-36" /></td>
                <td className="px-6 py-4 text-right"><Bar className="ml-auto h-7 w-[5.75rem] rounded-md" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-4">
        <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div>
            <Bar className="h-4 w-44" />
            <div className="mt-3 flex items-baseline gap-3">
              <Bar className="h-10 w-14" />
              <Bar className="h-4 w-16" />
            </div>
          </div>
          <div className="my-4">
            <Bar className="h-2.5 w-full rounded-full" />
            <div className="mt-2 flex items-center justify-between">
              <Bar className="h-5 w-28 rounded" />
              <Bar className="h-4 w-32" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <Bar className="mb-4 h-5 w-48" />
          <Bar className="mb-6 h-4 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-2.5">
                <Bar className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

export function PortfolioListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading portfolios">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
          <Bar className="h-7 w-40" />
          <Bar className="mt-2 h-5 w-full" />
          <Bar className="mt-4 h-6 w-28" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Bar className="h-7 w-[7.5rem] rounded-lg" />
            <Bar className="h-7 w-[6.5rem] rounded-lg" />
            <Bar className="h-7 w-[5.75rem] rounded-lg" />
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <Bar className="h-4 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdvisorProfileSkeleton() {
  return (
    <div className="mt-2 space-y-4" aria-busy="true" aria-label="Loading profile">
      <div>
        <Bar className="h-3 w-16" />
        <Bar className="mt-2 h-4 w-48" />
        <Bar className="mt-2 h-3 w-64" />
      </div>
      <div>
        <Bar className="h-3 w-20" />
        <Bar className="mt-2 h-10 w-full rounded-lg" />
      </div>
      <Bar className="h-10 w-28 rounded-lg" />
    </div>
  );
}

export function ReportHeaderSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading header">
      <Bar className="h-4 w-56" />
      <Bar className="h-3 w-full" />
      <Bar className="h-3 w-4/5" />
      <div>
        <Bar className="h-3 w-24" />
        <Bar className="mt-2 h-10 w-full rounded-lg" />
      </div>
      <Bar className="h-10 w-32 rounded-lg" />
    </div>
  );
}
