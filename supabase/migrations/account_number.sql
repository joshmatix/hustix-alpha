-- Account number replaces internal account number. A portfolio also belongs to a sub account.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios' AND column_name = 'internal_account_number'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'portfolios' AND column_name = 'account_number'
    ) THEN
      ALTER TABLE public.portfolios RENAME COLUMN internal_account_number TO account_number;
    ELSE
      UPDATE public.portfolios
      SET account_number = internal_account_number
      WHERE COALESCE(btrim(account_number), '') = ''
        AND COALESCE(btrim(internal_account_number), '') <> '';
      ALTER TABLE public.portfolios DROP COLUMN internal_account_number;
    END IF;
  END IF;
END $$;

ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS sub_account_number TEXT;
