"use client";

import React, { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

interface DeletePortfolioModalProps {
  portfolioName: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function DeletePortfolioModal({
  portfolioName,
  onClose,
  onConfirm,
}: DeletePortfolioModalProps) {
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTypedName("");
    setError(null);
  }, [portfolioName]);

  if (!portfolioName) return null;

  const nameMatches = typedName.trim() === portfolioName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameMatches) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      setTypedName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete portfolio.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-xl font-semibold text-white">Delete portfolio</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-sm text-slate-300">
            This removes <span className="font-semibold text-white">{portfolioName}</span> and
            its holdings. This cannot be undone.
          </p>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div>
            <label htmlFor="confirmPortfolioName" className="block text-sm font-medium text-slate-300">
              Type <span className="text-white">{portfolioName}</span> to confirm
            </label>
            <input
              id="confirmPortfolioName"
              type="text"
              autoFocus
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-rose-500 focus:outline-none"
            />
          </div>
          <div className="mt-6 flex justify-end space-x-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!nameMatches} isLoading={submitting}>
              Delete portfolio
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
