"use client";

import React, { useState } from "react";

interface CreatePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: { name: string; description: string }) => void | Promise<void>;
}

export default function CreatePortfolioModal({
  isOpen,
  onClose,
  onSubmit,
}: CreatePortfolioModalProps) {
  const [portfolioName, setPortfolioName] = useState("");
  const [description, setDescription] = useState("");
  const [showDescriptionInfo, setShowDescriptionInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit({ name: portfolioName, description });
      }
      setPortfolioName("");
      setDescription("");
      setShowDescriptionInfo(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create portfolio.");
    } finally {
      setSubmitting(false);
    }
  };

  // React event handler for closing the description popup/info box
  const handleCloseDescriptionPopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setShowDescriptionInfo(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-xl font-semibold text-white">
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
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              placeholder="e.g., Growth & Income"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder:text-slate-500 caret-slate-100 focus:border-indigo-500 focus:outline-none"
            />
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