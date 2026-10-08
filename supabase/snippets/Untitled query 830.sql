-- schema.sql: Client Accounts & Security Setup

CREATE TABLE advisor_portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advisor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    client_alias VARCHAR(50) NOT NULL, -- Anonymous identifier (e.g., "Account_9921")
    total_value NUMERIC(15, 2) NOT NULL,
    weights JSONB NOT NULL, -- Stores normalized weights {"Equities": 0.5, ...}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (Advisors can only read their own clients' data)
ALTER TABLE advisor_portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow advisor full access to own clients" 
ON advisor_portfolios 
FOR ALL 
USING (auth.uid() = advisor_id);