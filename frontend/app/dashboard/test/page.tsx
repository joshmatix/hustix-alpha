interface PortfolioFormData {
  name: string;
  description: string;
  riskTolerance: "Conservative" | "Moderate" | "Aggressive";
  initialValue: number;
}

const handleCreatePortfolio = async (formData: PortfolioFormData) => {
  // This line writes/inserts data into the Supabase 'portfolios' table:
  const { data, error } = await supabase.from('portfolios').insert([
    {
      name: formData.name,
      description: formData.description,
      risk_tolerance: formData.riskTolerance,
      initial_value: formData.initialValue,
    },
  ]);

  if (error) {
    console.error("Error inserting into Supabase:", error);
    throw error;
  }

  // Refresh portfolios list after insertion
  //await fetchPortfolios();
};