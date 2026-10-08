CREATE POLICY "Advisors can access assigned portfolios" 
ON portfolios
FOR ALL 
USING (
    EXISTS (
        SELECT 1 
        FROM advisor_portfolios ap 
        WHERE ap.portfolio_id = portfolios.portfolio_id 
          AND ap.advisor_id = auth.uid()
    )
);
  