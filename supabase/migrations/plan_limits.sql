-- Portfolio and ticker caps live on the plan. NULL means that plan is not capped.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS portfolio_limit INTEGER,
  ADD COLUMN IF NOT EXISTS ticker_limit INTEGER;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_portfolio_limit_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_portfolio_limit_check
  CHECK (portfolio_limit IS NULL OR portfolio_limit >= 0);

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_ticker_limit_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_ticker_limit_check
  CHECK (ticker_limit IS NULL OR ticker_limit >= 0);

UPDATE public.plans
SET portfolio_limit = 3, ticker_limit = 5
WHERE code = 'free';

UPDATE public.plans
SET portfolio_limit = 100, ticker_limit = NULL
WHERE code = 'pro';

UPDATE public.plans
SET portfolio_limit = NULL, ticker_limit = NULL
WHERE code IN ('pro_plus', 'enterprise');

CREATE OR REPLACE FUNCTION public.plan_cap(target_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'code', plan.code,
    'name', plan.name,
    'portfolio_limit', plan.portfolio_limit,
    'ticker_limit', plan.ticker_limit,
    'upgrade_code', upgrade.code,
    'upgrade_name', upgrade.name
  )
  FROM public.plans AS plan
  LEFT JOIN LATERAL (
    SELECT candidate.code, candidate.name
    FROM public.plans AS candidate
    WHERE candidate.selectable
      AND candidate.monthly_cents IS NOT NULL
      AND candidate.monthly_cents > COALESCE(plan.monthly_cents, -1)
    ORDER BY candidate.monthly_cents
    LIMIT 1
  ) AS upgrade ON true
  WHERE plan.code = COALESCE(
    (
      SELECT known.code
      FROM public.plans AS known
      WHERE known.code = COALESCE(NULLIF(btrim(target_code), ''), 'free')
    ),
    'free'
  );
$$;

CREATE OR REPLACE FUNCTION public.portfolio_limit_message(target_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caps JSONB;
  cap INTEGER;
  sentence TEXT;
BEGIN
  caps := public.plan_cap(target_code);
  IF caps IS NULL OR caps->>'portfolio_limit' IS NULL THEN
    RETURN NULL;
  END IF;
  cap := (caps->>'portfolio_limit')::INTEGER;
  sentence := format('%s accounts can hold %s portfolios.', caps->>'name', cap);
  IF caps->>'upgrade_name' IS NOT NULL THEN
    sentence := sentence || format(' Upgrade to %s to add another.', caps->>'upgrade_name');
  END IF;
  RETURN sentence;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticker_limit_message(target_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caps JSONB;
  cap INTEGER;
  sentence TEXT;
BEGIN
  caps := public.plan_cap(target_code);
  IF caps IS NULL OR caps->>'ticker_limit' IS NULL THEN
    RETURN NULL;
  END IF;
  cap := (caps->>'ticker_limit')::INTEGER;
  sentence := format('%s accounts are limited to %s tickers per portfolio.', caps->>'name', cap);
  IF caps->>'upgrade_name' IS NOT NULL THEN
    sentence := sentence || format(' Upgrade to %s to add more.', caps->>'upgrade_name');
  END IF;
  RETURN sentence;
END;
$$;

CREATE OR REPLACE FUNCTION public.plan_catalog()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'code', plan.code,
        'name', plan.name,
        'monthly_cents', plan.monthly_cents,
        'portfolio_limit', plan.portfolio_limit,
        'ticker_limit', plan.ticker_limit
      )
      ORDER BY plan.monthly_cents, plan.code
    ),
    '[]'::jsonb
  )
  FROM public.plans AS plan
  WHERE plan.selectable
    AND plan.monthly_cents IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.assert_free_ticker_limit(target_portfolio UUID, incoming JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  current_plan TEXT;
  caps JSONB;
  ticker_cap INTEGER;
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

  caps := public.plan_cap(COALESCE(current_plan, 'free'));
  IF caps IS NULL OR caps->>'ticker_limit' IS NULL THEN
    RETURN;
  END IF;
  ticker_cap := (caps->>'ticker_limit')::INTEGER;

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

  IF ticker_count > ticker_cap THEN
    RAISE EXCEPTION '%', public.ticker_limit_message(COALESCE(current_plan, 'free'));
  END IF;
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
  caps JSONB;
  portfolio_cap INTEGER;
  portfolio_count INTEGER;
BEGIN
  SELECT portfolio.firm_id INTO target_firm
  FROM public.portfolios AS portfolio
  WHERE portfolio.id = NEW.portfolio_id;

  SELECT subscription.plan_code INTO current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  caps := public.plan_cap(COALESCE(current_plan, 'free'));
  IF caps IS NULL OR caps->>'portfolio_limit' IS NULL THEN
    RETURN NULL;
  END IF;
  portfolio_cap := (caps->>'portfolio_limit')::INTEGER;

  SELECT count(*) INTO portfolio_count
  FROM public.portfolio_advisors AS assignment
  WHERE assignment.user_id = NEW.user_id;

  IF portfolio_count > portfolio_cap THEN
    RAISE EXCEPTION '%', public.portfolio_limit_message(COALESCE(current_plan, 'free'));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.firm_subscription_quote()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  owns BOOLEAN;
  seat_count INTEGER;
  list_cents INTEGER;
  price_cents INTEGER;
  plan_row public.plans%ROWTYPE;
  subscription_row public.subscriptions%ROWTYPE;
  applied jsonb;
  promo record;
BEGIN
  target_firm := public.advisor_firm_id(false);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'No firm found for this account';
  END IF;

  owns := COALESCE(public.advisor_firm_id(true) = target_firm, false);

  SELECT * INTO subscription_row
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF subscription_row.id IS NULL THEN
    RAISE EXCEPTION 'No subscription found for this firm';
  END IF;

  SELECT * INTO plan_row
  FROM public.plans
  WHERE code = subscription_row.plan_code;

  SELECT count(*) INTO seat_count
  FROM public.firm_members AS member
  WHERE member.firm_id = target_firm;

  IF plan_row.monthly_cents IS NULL THEN
    list_cents := NULL;
  ELSE
    list_cents := plan_row.monthly_cents
      + GREATEST(seat_count - 1, 0) * COALESCE(plan_row.additional_seat_cents, 0);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', promotion.code,
    'label', promotion.label,
    'percent_off', promotion.percent_off,
    'amount_off_cents', promotion.amount_off_cents,
    'ends_at', COALESCE(applied_row.ends_at, promotion.ends_at)
  ) ORDER BY promotion.code), '[]'::jsonb)
  INTO applied
  FROM public.subscription_promotions AS applied_row
  JOIN public.promotions AS promotion ON promotion.code = applied_row.promotion_code
  WHERE applied_row.subscription_id = subscription_row.id
    AND promotion.active
    AND subscription_row.plan_code = ANY (promotion.applies_to)
    AND (promotion.starts_at IS NULL OR promotion.starts_at <= timezone('utc'::text, now()))
    AND (promotion.ends_at IS NULL OR promotion.ends_at > timezone('utc'::text, now()))
    AND (applied_row.ends_at IS NULL OR applied_row.ends_at > timezone('utc'::text, now()));

  price_cents := list_cents;
  IF list_cents IS NOT NULL THEN
    FOR promo IN
      SELECT item
      FROM jsonb_array_elements(applied) AS item
      WHERE item->>'percent_off' IS NOT NULL
      ORDER BY item->>'code'
    LOOP
      price_cents := (price_cents * (100 - (promo.item->>'percent_off')::integer)) / 100;
    END LOOP;
    FOR promo IN
      SELECT item
      FROM jsonb_array_elements(applied) AS item
      WHERE item->>'amount_off_cents' IS NOT NULL
      ORDER BY item->>'code'
    LOOP
      price_cents := GREATEST(price_cents - (promo.item->>'amount_off_cents')::integer, 0);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'plan_code', subscription_row.plan_code,
    'plan_name', plan_row.name,
    'status', subscription_row.status,
    'seats', seat_count,
    'monthly_cents', list_cents,
    'price_cents', price_cents,
    'portfolio_limit', plan_row.portfolio_limit,
    'ticker_limit', plan_row.ticker_limit,
    'can_manage', owns,
    'promotion', CASE
      WHEN jsonb_array_length(applied) = 0 THEN NULL
      ELSE applied->0
    END,
    'promotions', applied
  );
END;
$$;

ALTER FUNCTION public.plan_cap(TEXT) OWNER TO postgres;
ALTER FUNCTION public.portfolio_limit_message(TEXT) OWNER TO postgres;
ALTER FUNCTION public.ticker_limit_message(TEXT) OWNER TO postgres;
ALTER FUNCTION public.plan_catalog() OWNER TO postgres;
ALTER FUNCTION public.assert_free_ticker_limit(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.enforce_free_portfolio_limit() OWNER TO postgres;
ALTER FUNCTION public.firm_subscription_quote() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.plan_cap(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_cap(TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.portfolio_limit_message(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portfolio_limit_message(TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.ticker_limit_message(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticker_limit_message(TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.plan_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_catalog() TO anon, authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.firm_subscription_quote() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.firm_subscription_quote() TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.enforce_free_portfolio_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_portfolio_limit() TO postgres, service_role;
