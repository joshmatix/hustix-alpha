-- Free firms can hold 5 distinct traded tickers across every portfolio.
-- Cash lines do not count. Pro and Enterprise are not capped.

CREATE OR REPLACE FUNCTION public.is_cash_symbol(ticker TEXT, asset_class TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(COALESCE(asset_class, ''))) = 'cash'
    OR upper(replace(btrim(COALESCE(ticker, '')), '.', '-')) IN ('CASH', 'USD', 'USD-CASH');
$$;

CREATE OR REPLACE FUNCTION public.assert_free_ticker_limit(target_firm UUID, incoming JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_plan TEXT;
  ticker_count INTEGER;
BEGIN
  IF target_firm IS NULL THEN
    RETURN;
  END IF;

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
    JOIN public.portfolios AS portfolio ON portfolio.id = holding.portfolio_id
    WHERE portfolio.firm_id = target_firm
      AND NOT public.is_cash_symbol(holding.ticker, holding.asset_class)
    UNION
    SELECT upper(replace(btrim(item->>'ticker'), '.', '-')) AS symbol
    FROM jsonb_array_elements(COALESCE(incoming, '[]'::jsonb)) AS item
    WHERE NOT public.is_cash_symbol(item->>'ticker', item->>'asset_class')
      AND btrim(COALESCE(item->>'ticker', '')) <> ''
  ) AS symbols;

  IF ticker_count > 5 THEN
    RAISE EXCEPTION 'Free accounts are limited to 5 tickers. Upgrade to Pro to add more.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_free_ticker_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
BEGIN
  SELECT portfolio.firm_id INTO target_firm
  FROM public.portfolios AS portfolio
  WHERE portfolio.id = NEW.portfolio_id;

  PERFORM public.assert_free_ticker_limit(target_firm, '[]'::jsonb);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS holdings_free_ticker_limit ON public.portfolio_holdings;
CREATE CONSTRAINT TRIGGER holdings_free_ticker_limit
  AFTER INSERT OR UPDATE OF ticker, asset_class ON public.portfolio_holdings
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_free_ticker_limit();

ALTER FUNCTION public.is_cash_symbol(TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.assert_free_ticker_limit(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.enforce_free_ticker_limit() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_cash_symbol(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_cash_symbol(TEXT, TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.assert_free_ticker_limit(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_free_ticker_limit(UUID, JSONB) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.enforce_free_ticker_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_ticker_limit() TO postgres, service_role;
