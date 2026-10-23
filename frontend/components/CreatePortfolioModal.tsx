"use client";

import React, { useEffect, useRef, useState } from "react";

interface CreatePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: {
    name: string;
    description: string;
    accountNumber: string;
    subAccountNumber: string;
    file: File | null;
  }) => void | Promise<void>;
}

function labelFromCsv(file: File) {
  const base = file.name.split(/[/\\]/).pop() || file.name;
  return base.replace(/\.csv$/i, "") || base;
}

export default function CreatePortfolioModal({
  isOpen,
  onClose,
  onSubmit,
}: CreatePortfolioModalProps) {
  const [portfolioName, setPortfolioName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [subAccountNumber, setSubAccountNumber] = useState("");
  const [description, setDescription] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [showDescriptionInfo, setShowDescriptionInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(isOpen);
  onCloseRef.current = onClose;
  if (typeof document !== "undefined" && isOpen && !wasOpen.current) {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = isOpen;

  useEffect(() => {
    if (!isOpen) return;
    setPortfolioName("");
    setAccountNumber("");
    setSubAccountNumber("");
    setDescription("");
    setCsvFile(null);
    setError(null);
    setShowDescriptionInfo(false);
    if (fileRef.current) fileRef.current.value = "";
    const root = dialogRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit({
          name: portfolioName,
          description,
          accountNumber,
          subAccountNumber,
          file: csvFile,
        });
      }
      setPortfolioName("");
      setAccountNumber("");
      setSubAccountNumber("");
      setDescription("");
      setCsvFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setShowDescriptionInfo(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create portfolio.");
    } finally {
      setSubmitting(false);
    }
  };

  // React event handler for closing the description popup/info box
  const handleCsv = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setCsvFile(file);
    if (!file) return;
    const label = labelFromCsv(file);
    setPortfolioName(label);
    setDescription(label);
  };

  const handleCloseDescriptionPopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setShowDescriptionInfo(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-portfolio-title"
        className="relative w-full max-w-3xl rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="create-portfolio-title" className="text-xl font-semibold text-white">
            Create New Portfolio
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <p className="text-sm text-rose-500">{error}</p>
          )}
          <div>
            <label htmlFor="portfolioCsv" className="block text-sm font-medium text-slate-300">
              Upload CSV file
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
              <input
                ref={fileRef}
                id="portfolioCsv"
                type="file"
                accept=".csv,.CSV,text/csv"
                onChange={handleCsv}
                className="min-w-0 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500"
              />
              <a
                href="/samples/holdings-sample.csv"
                download="holdings-sample.csv"
                className="inline-flex shrink-0 items-center rounded-md border border-indigo-400 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
              >
                Download sample CSV
              </a>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Download the sample, then choose that file. Its name becomes the portfolio name and description. You can edit both before creating.
            </p>
          </div>
          <div>
            <label
              htmlFor="portfolioName"
              className="block text-sm font-medium text-slate-300"
            >
              Portfolio Name
            </label>
            <input
              id="portfolioName"
              type="text"
              required
              autoFocus
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              placeholder="e.g., Growth & Income"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-red-500">Do not use</span>
              : SSNs, Tax IDs, passport numbers or other Personally Identifiable Information
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="accountNumber" className="block text-sm font-medium text-slate-300">
                  Client Master ID
                </label>
                <input
                  id="accountNumber"
                  type="text"
                  required
                  maxLength={64}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Client Master ID"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="subAccountNumber" className="block text-sm font-medium text-slate-300">
                  Sub-Account
                </label>
                <input
                  id="subAccountNumber"
                  type="text"
                  required
                  maxLength={64}
                  value={subAccountNumber}
                  onChange={(e) => setSubAccountNumber(e.target.value)}
                  placeholder="Sub-Account for this portfolio"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="description"
                className="block text-sm font-medium text-slate-300"
              >
                Description
              </label>
              <button
                type="button"
                onClick={() => setShowDescriptionInfo(!showDescriptionInfo)}
                className="text-xs text-indigo-400 hover:underline"
              >
                {showDescriptionInfo ? "Hide Info" : "What is this?"}
              </button>
            </div>

            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the strategy or target assets..."
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Description Helper Popup/Card */}
          {showDescriptionInfo && (
            <div className="relative rounded-md border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-200">
              <p>
                Adding a description helps advisors track strategy goals and
                rebalancing triggers for this client.
              </p>
              <button
                type="button"
                onClick={handleCloseDescriptionPopup}
                className="mt-2 text-xs font-semibold text-indigo-300 underline hover:text-indigo-200"
              >
                Close Info
              </button>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Portfolio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}