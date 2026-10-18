import Link from 'next/link';
import AgreementBody from '@/components/auth/AgreementBody';

export const metadata = {
  title: 'Hustix Macro Customer Agreement',
  description: 'The agreement for a Hustix Macro advisor account.',
};

export default function AgreementPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mb-6 w-full max-w-3xl">
        <Link href="/" className="text-xs font-medium text-slate-400 hover:text-slate-200">
          &larr; Back to Home
        </Link>
      </div>
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8">
        <AgreementBody />
      </div>
    </main>
  );
}
