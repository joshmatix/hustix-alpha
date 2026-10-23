-- Phase 1: every firm is on Pro+, whatever plan was stored before.

CREATE OR REPLACE FUNCTION public.effective_plan_code(stored_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'pro_plus'::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.ensure_firm_subscription(target_firm UUID, requested_plan TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'firm is required';
  END IF;

  INSERT INTO public.subscriptions (firm_id, plan_code)
  VALUES (target_firm, 'pro_plus')
  ON CONFLICT (firm_id) DO UPDATE
  SET plan_code = 'pro_plus';

  RETURN 'pro_plus';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_firm_plan(target TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
BEGIN
  IF lower(COALESCE(target, '')) IS DISTINCT FROM 'pro_plus' THEN
    RAISE EXCEPTION 'During this phase every account is Pro+';
  END IF;

  target_firm := public.advisor_firm_id(true);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'Only a firm owner can change the plan';
  END IF;

  UPDATE public.subscriptions AS subscription
  SET plan_code = 'pro_plus',
      status = 'active',
      ends_at = NULL
  WHERE subscription.firm_id = target_firm;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No subscription found for this firm';
  END IF;

  PERFORM public.mirror_firm_plan(target_firm);
  RETURN public.firm_subscription_quote();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_advisor_plan(target_user UUID, target_plan TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  chosen TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'Unknown advisor';
  END IF;

  chosen := lower(btrim(COALESCE(target_plan, '')));
  IF chosen NOT IN ('free', 'pro', 'pro_plus', 'enterprise') THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  target_firm := public._admin_advisor_firm(target_user);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'This advisor has no firm';
  END IF;

  INSERT INTO public.subscriptions (firm_id, plan_code, status)
  VALUES (target_firm, 'pro_plus', 'active')
  ON CONFLICT (firm_id) DO UPDATE
  SET plan_code = 'pro_plus',
      status = 'active',
      ends_at = NULL;

  PERFORM public.mirror_firm_plan(target_firm);
  RETURN public.admin_directory();
END;
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

  current_plan := public.effective_plan_code(current_plan);
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

  current_plan := public.effective_plan_code(current_plan);
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
  effective TEXT;
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

  effective := public.effective_plan_code(subscription_row.plan_code);

  SELECT * INTO plan_row
  FROM public.plans
  WHERE code = effective;

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
    AND effective = ANY (promotion.applies_to)
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
    'plan_code', effective,
    'plan_name', plan_row.name,
    'phase', 1,
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

UPDATE public.subscriptions
SET plan_code = 'pro_plus'
WHERE plan_code IS DISTINCT FROM 'pro_plus';

DO $$
BEGIN
  PERFORM set_config('macrorisk.plan_write', 'on', true);
  UPDATE public.profiles
  SET plan = 'pro_plus'
  WHERE plan IS DISTINCT FROM 'pro_plus';
END $$;

ALTER FUNCTION public.effective_plan_code(TEXT) OWNER TO postgres;
ALTER FUNCTION public.ensure_firm_subscription(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.set_firm_plan(TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_set_advisor_plan(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.assert_free_ticker_limit(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.enforce_free_portfolio_limit() OWNER TO postgres;
ALTER FUNCTION public.firm_subscription_quote() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.effective_plan_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_plan_code(TEXT) TO authenticated, service_role, postgres;
