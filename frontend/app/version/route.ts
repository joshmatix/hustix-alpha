import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Live deployment id. Kept off /api because that prefix is routed to the Python service. */
export function GET() {
  // Same value inlined into the client bundle by next.config. A different
  // fallback here makes the alert survive a reload.
  const id = process.env.NEXT_PUBLIC_DEPLOYMENT_ID || 'local';

  return NextResponse.json(
    { id },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    },
  );
}
