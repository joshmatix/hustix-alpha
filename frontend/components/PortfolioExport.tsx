"use client";

import React from "react";

export default function DownloadReportButton() {
  // Define the download function inside the React component
  const handleDownload = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    try {
      const response = await fetch("http://localhost:8000/api/portfolios/export");
      const blob = await response.blob();
      
      // Create a blob URL to trigger the file download programmatically
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "macro_stress_test_report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    // ✅ CORRECT: Pass the function reference as a JSX expression
    <a
      href="#"
      onClick={handleDownload}
      className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Download Report
    </a>
  );
}