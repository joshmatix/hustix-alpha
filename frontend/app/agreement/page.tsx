import Link from 'next/link';
import AgreementBody from '@/components/auth/AgreementBody';
import { fetchAgreement } from '@/lib/agreement';

export const metadata = {
  title: 'Hustix Macro Customer Agreement',
  description: 'The agreement for a Hustix Macro advisor account.',
};

export default async function AgreementPage({
  searchParams,
}: {
  searchParams: { version?: string };
}) {
  const requested = typeof searchParams.version === 'string' ? searchParams.version : undefined;
  const agreement = await fetchAgreement(requested);

  return (
    <main className="flex flex-1 flex-col items-center bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mb-6 w-full max-w-3xl">
        <Link href="/" className="text-xs font-medium text-slate-400 hover:text-slate-200">
          &larr; Back to Home
        </Link>
      </div>
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8">
        {agreement ? (
          <AgreementBody agreement={agreement} />
        ) : (
          <p className="text-sm text-slate-400">
            {requested ? 'That agreement version is not on file.' : 'The agreement could not be loaded.'}
          </p>
        )}
      </div>
    </main>
  );
}
