"use client";

import React, { useState } from "react";

interface CreatePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: { name: string; description: string }) => void;
}

export default function CreatePortfolioModal({
  isOpen,
  onClose,
  onSubmit,
}: CreatePortfolioModalProps) {
  const [portfolioName, setPortfolioName] = useState("");
  const [description, setDescription] = useState("");
  const [showDescriptionInfo, setShowDescriptionInfo] = useState(false);

  if (!isOpen) return null;

  // React event handler for form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit({ name: portfolioName, description });
    }
    // Reset state and close modal
    setPortfolioName("");
    setDescription("");
    setShowDescriptionInfo(false);
    onClose();
  };

  // React event handler for closing the description popup/info box
  const handleCloseDescriptionPopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setShowDescriptionInfo(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Create New Portfolio
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="portfolioName"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
              className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="description"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Description
              </label>
              <button
                type="button"
                onClick={() => setShowDescriptionInfo(!showDescriptionInfo)}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
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
              className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Description Helper Popup/Card */}
          {showDescriptionInfo && (
            <div className="relative rounded-md bg-blue-50 p-3 text-xs text-blue-800 dark:bg-gray-700 dark:text-blue-200">
              <p>
                Adding a description helps advisors track strategy goals and
                rebalancing triggers for this client.
              </p>
              <button
                type="button"
                onClick={handleCloseDescriptionPopup}
                className="mt-2 text-xs font-semibold text-blue-600 underline hover:text-blue-800 dark:text-blue-300"
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
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none"
            >
              Create Portfolio
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}