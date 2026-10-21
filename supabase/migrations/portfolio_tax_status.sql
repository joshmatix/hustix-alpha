-- Portfolio tax treatment. Existing portfolios stay unset until recreated.
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS tax_status TEXT;

ALTER TABLE public.portfolios DROP CONSTRAINT IF EXISTS portfolios_tax_status_check;
ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_tax_status_check
  CHECK (tax_status IS NULL OR tax_status IN ('taxable', 'tax_deferred', 'tax_exempt'));
