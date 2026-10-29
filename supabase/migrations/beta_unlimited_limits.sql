-- Beta: no portfolio or ticker caps. Restore plan numbers later when billing resumes.

UPDATE public.plans
SET portfolio_limit = NULL,
    ticker_limit = NULL;

CREATE OR REPLACE FUNCTION public.effective_plan_code(stored_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'pro_plus'::TEXT;
$$;

-- Drop both historical signatures, then install the portfolio-scoped no-op used by holdings.
DROP FUNCTION IF EXISTS public.assert_free_ticker_limit(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.assert_free_ticker_limit(target_portfolio UUID, incoming JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_free_portfolio_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.effective_plan_code(TEXT) OWNER TO postgres;
ALTER FUNCTION public.assert_free_ticker_limit(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.enforce_free_portfolio_limit() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.effective_plan_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_plan_code(TEXT) TO postgres, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_free_ticker_limit(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_free_ticker_limit(UUID, JSONB) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.enforce_free_portfolio_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_portfolio_limit() TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
