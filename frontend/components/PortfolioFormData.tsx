"use client";

export interface PortfolioFormData {
  name: string;
  description: string;
  riskTolerance: "Conservative" | "Moderate" | "Aggressive";
  initialValue: number;
}