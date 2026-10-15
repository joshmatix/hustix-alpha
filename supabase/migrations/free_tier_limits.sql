-- Free tier: 3 portfolios per advisor, 5 distinct tickers in each portfolio.
-- Pro holds 100 portfolios per advisor. Pro+ and Enterprise are not capped.
-- A larger file is parsed in the app and not stored until the firm upgrades.

DROP TRIGGER IF EXISTS holdings_free_ticker_limit ON public.portfolio_holdings;
DROP FUNCTION IF EXISTS public.assert_free_ticker_limit(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.assert_free_ticker_limit(target_portfolio UUID, incoming JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  current_plan TEXT;
  ticker_count INTEGER;
BEGIN
  IF target_portfolio IS NULL THEN
    RETURN;
  END IF;

  SELECT portfolio.firm_id INTO target_firm
  FROM public.portfolios AS portfolio
  WHERE portfolio.id = target_portfolio;

  SELECT subscription.plan_code INTO current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF current_plan IS NOT NULL AND current_plan <> 'free' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO ticker_count
  FROM (
    SELECT upper(replace(btrim(holding.ticker), '.', '-')) AS symbol
    FROM public.portfolio_holdings AS holding
    WHERE holding.portfolio_id = target_portfolio
      AND btrim(COALESCE(holding.ticker, '')) <> ''
    UNION
    SELECT upper(replace(btrim(item->>'ticker'), '.', '-')) AS symbol
    FROM jsonb_array_elements(COALESCE(incoming, '[]'::jsonb)) AS item
    WHERE btrim(COALESCE(item->>'ticker', '')) <> ''
  ) AS symbols;

  IF ticker_count > 5 THEN
    RAISE EXCEPTION 'Free accounts are limited to 5 tickers per portfolio. Upgrade to Pro to add more.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_free_ticker_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_free_ticker_limit(NEW.portfolio_id, '[]'::jsonb);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_free_portfolio_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  current_plan TEXT;
  book_count INTEGER;
BEGIN
  SELECT portfolio.firm_id INTO target_firm
  FROM public.portfolios AS portfolio
  WHERE portfolio.id = NEW.portfolio_id;

  SELECT subscription.plan_code INTO current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF current_plan IN ('pro_plus', 'enterprise') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO book_count
  FROM public.portfolio_advisors AS assignment
  WHERE assignment.user_id = NEW.user_id;

  IF (current_plan IS NULL OR current_plan = 'free') AND book_count > 3 THEN
    RAISE EXCEPTION 'Free accounts can hold 3 portfolios. Upgrade to Pro to add another.';
  END IF;
  IF current_plan = 'pro' AND book_count > 100 THEN
    RAISE EXCEPTION 'This advisor can hold 100 portfolios. Upgrade to Pro+ to add another.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER holdings_free_ticker_limit
  AFTER INSERT OR UPDATE OF ticker ON public.portfolio_holdings
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_free_ticker_limit();

DROP TRIGGER IF EXISTS assignments_free_portfolio_limit ON public.portfolio_advisors;
CREATE CONSTRAINT TRIGGER assignments_free_portfolio_limit
  AFTER INSERT ON public.portfolio_advisors
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_free_portfolio_limit();

ALTER FUNCTION public.assert_free_ticker_limit(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.enforce_free_ticker_limit() OWNER TO postgres;
ALTER FUNCTION public.enforce_free_portfolio_limit() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enforce_free_portfolio_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_portfolio_limit() TO postgres, service_role;
