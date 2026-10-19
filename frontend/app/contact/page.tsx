'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/support/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message, website }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.detail === 'string' ? body.detail : 'Questions cannot be sent right now.');
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="mb-6 w-full max-w-md">
        <Link href="/" className="text-xs font-medium text-slate-400 transition hover:text-slate-200">
          &larr; Back to Home
        </Link>
      </div>

      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl backdrop-blur-sm">
        <div className="space-y-2 text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <img src="/favicon.png" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Hustix Macro</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Any questions?</h2>
          <p className="text-xs text-slate-400">
            Send a note and we will reply to the email you enter.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
            <span>&bull;</span>
            <span>{error}</span>
          </div>
        )}

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              We received your question and will reply by email.
            </div>
            <Link
              href="/"
              className="block w-full rounded-lg bg-indigo-600 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
            >
              Return home
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col">
              <label htmlFor="contact-name" className="mb-2 block text-xs font-medium leading-none text-slate-300">
                Name
              </label>
              <input
                id="contact-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="contact-email" className="mb-2 block text-xs font-medium leading-none text-slate-300">
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="contact-message" className="mb-2 block text-xs font-medium leading-none text-slate-300">
                Question
              </label>
              <textarea
                id="contact-message"
                required
                rows={5}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              className="hidden"
            />
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:bg-indigo-600/50"
            >
              {loading ? 'Sending...' : 'Send question'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
