-- Advisor-entered account id. Existing portfolios stay blank until recreated.
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS internal_account_number TEXT;
