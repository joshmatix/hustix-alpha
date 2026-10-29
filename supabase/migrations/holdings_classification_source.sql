-- Per-firm: CSV asset_class vs Tiingo authoritative classification on holdings upload.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS holdings_classification_source TEXT NOT NULL DEFAULT 'csv';

ALTER TABLE public.firms
  DROP CONSTRAINT IF EXISTS firms_holdings_classification_source_check;

ALTER TABLE public.firms
  ADD CONSTRAINT firms_holdings_classification_source_check
  CHECK (holdings_classification_source IN ('csv', 'authoritative'));

CREATE OR REPLACE FUNCTION public.set_holdings_classification_source(source TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  normalized := lower(btrim(COALESCE(source, '')));
  IF normalized NOT IN ('csv', 'authoritative') THEN
    RAISE EXCEPTION 'Source must be csv or authoritative';
  END IF;

  UPDATE public.firms AS firm
  SET holdings_classification_source = normalized
  WHERE firm.id IN (
    SELECT member.firm_id
    FROM public.firm_members AS member
    WHERE member.user_id = auth.uid()
      AND member.role = 'owner'
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No firm found for this account';
  END IF;

  RETURN normalized;
END;
$$;

ALTER FUNCTION public.set_holdings_classification_source(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_holdings_classification_source(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_holdings_classification_source(TEXT) TO authenticated, service_role, postgres;
