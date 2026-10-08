"use client";

import React, { useState, useEffect } from "react";
import CreatePortfolioModal from "@/components/CreatePortfolioModal";

interface Portfolio {
  id: string;
  name: string;
  description: string;
}

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch existing portfolios from backend API
  const fetchPortfolios = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("http://localhost:8000/api/portfolios");
      if (res.ok) {
        const data = await res.json();
        setPortfolios(data);
      }
    } catch (error) {
      console.error("Failed to fetch portfolios:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolios();
  }, []);

  const handleCreatePortfolio = async (data: { name: string; description: string }) => {
    try {
      const res = await fetch("http://localhost:8000/api/portfolios/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        // Refresh portfolios after creating
        fetchPortfolios();
      }
    } catch (error) {
      console.error("Error creating portfolio:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl">
        {/* Page Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Portfolios
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Manage client portfolios and perform macro risk analysis.
            </p>
          </div>

          {/* Top-level Create Portfolio Button */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <span>+</span> Create Portfolio
          </button>
        </div>

        {/* Portfolios Content Grid or Empty State */}
        {isLoading ? (
          <div className="py-12 text-center text-gray-500">Loading portfolios...</div>
        ) : portfolios.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              No portfolios available
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Create a new portfolio to get started with stress testing.
            </p>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                + Create Portfolio
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {portfolios.map((portfolio) => (
              <div
                key={portfolio.id}
                className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {portfolio.name}
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {portfolio.description || "No description provided."}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Modal Component */}
        <CreatePortfolioModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleCreatePortfolio}
        />
      </div>
    </div>
  );
}