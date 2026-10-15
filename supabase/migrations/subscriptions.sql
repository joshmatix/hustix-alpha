-- Firm subscription. The plan is the tier. A promotion is a discount on that
-- tier, not another tier. Seats are the advisors on the firm.

CREATE TABLE IF NOT EXISTS public.plans (
  code TEXT PRIMARY KEY CHECK (code IN ('free', 'pro', 'pro_plus', 'enterprise')),
  name TEXT NOT NULL,
  monthly_cents INTEGER CHECK (monthly_cents IS NULL OR monthly_cents >= 0),
  additional_seat_cents INTEGER CHECK (additional_seat_cents IS NULL OR additional_seat_cents >= 0),
  portfolio_limit INTEGER CHECK (portfolio_limit IS NULL OR portfolio_limit >= 0),
  ticker_limit INTEGER CHECK (ticker_limit IS NULL OR ticker_limit >= 0),
  selectable BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.plans (code, name, monthly_cents, additional_seat_cents, portfolio_limit, ticker_limit, selectable)
VALUES
  ('free', 'Free', 0, NULL, 3, 5, true),
  ('pro', 'Pro', 11900, 9900, 100, NULL, true),
  ('pro_plus', 'Pro+', 19900, 9900, NULL, NULL, true),
  ('enterprise', 'Enterprise', NULL, NULL, NULL, NULL, false)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    monthly_cents = EXCLUDED.monthly_cents,
    additional_seat_cents = EXCLUDED.additional_seat_cents,
    portfolio_limit = EXCLUDED.portfolio_limit,
    ticker_limit = EXCLUDED.ticker_limit,
    selectable = EXCLUDED.selectable;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL UNIQUE REFERENCES public.firms(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES public.plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  ends_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.promotions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  percent_off INTEGER,
  amount_off_cents INTEGER,
  applies_to TEXT[] NOT NULL,
  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE,
  active BOOLEAN NOT NULL DEFAULT true,
  CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  CHECK (amount_off_cents IS NULL OR amount_off_cents > 0),
  CHECK ((percent_off IS NOT NULL) <> (amount_off_cents IS NOT NULL)),
  CHECK (cardinality(applies_to) > 0),
  CHECK (applies_to <@ ARRAY['free', 'pro', 'pro_plus', 'enterprise']::TEXT[]),
  CHECK (code = upper(code))
);

CREATE TABLE IF NOT EXISTS public.subscription_promotions (
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  promotion_code TEXT NOT NULL REFERENCES public.promotions(code),
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  ends_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (subscription_id, promotion_code)
);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'pro', 'pro_plus', 'enterprise'));

CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND current_setting('macrorisk.plan_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Plan changes go through the firm subscription';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_plan ON public.profiles;
CREATE TRIGGER profiles_protect_plan
  BEFORE UPDATE OF plan ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_plan();

CREATE OR REPLACE FUNCTION public.ensure_firm_subscription(target_firm UUID, requested_plan TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen TEXT;
  current_plan TEXT;
BEGIN
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'firm is required';
  END IF;

  chosen := lower(COALESCE(requested_plan, 'free'));
  IF chosen NOT IN ('pro', 'pro_plus') THEN
    chosen := 'free';
  END IF;

  INSERT INTO public.subscriptions (firm_id, plan_code)
  VALUES (target_firm, chosen)
  ON CONFLICT (firm_id) DO NOTHING;

  SELECT subscription.plan_code INTO current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  RETURN current_plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.advisor_firm_id(require_owner BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  found UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT member.firm_id INTO found
  FROM public.firm_members AS member
  WHERE member.user_id = auth.uid()
    AND (NOT require_owner OR member.role = 'owner')
  ORDER BY (member.role = 'owner') DESC, member.created_at
  LIMIT 1;

  RETURN found;
END;
$$;

CREATE OR REPLACE FUNCTION public.mirror_firm_plan(target_firm UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_plan TEXT;
BEGIN
  SELECT subscription.plan_code INTO current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF current_plan IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('macrorisk.plan_write', 'on', true);
  UPDATE public.profiles AS profile
  SET plan = current_plan
  WHERE profile.id IN (
    SELECT member.user_id
    FROM public.firm_members AS member
    WHERE member.firm_id = target_firm
  )
  AND profile.plan IS DISTINCT FROM current_plan;
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
  promo_code TEXT;
  promo_label TEXT;
  promo_percent INTEGER;
  promo_amount INTEGER;
  promo_ends TIMESTAMP WITH TIME ZONE;
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

  SELECT promotion.code, promotion.label, promotion.percent_off, promotion.amount_off_cents, applied.ends_at
  INTO promo_code, promo_label, promo_percent, promo_amount, promo_ends
  FROM public.subscription_promotions AS applied
  JOIN public.promotions AS promotion ON promotion.code = applied.promotion_code
  WHERE applied.subscription_id = subscription_row.id
    AND promotion.active
    AND subscription_row.plan_code = ANY (promotion.applies_to)
    AND (promotion.starts_at IS NULL OR promotion.starts_at <= timezone('utc'::text, now()))
    AND (promotion.ends_at IS NULL OR promotion.ends_at > timezone('utc'::text, now()))
    AND (applied.ends_at IS NULL OR applied.ends_at > timezone('utc'::text, now()))
  ORDER BY applied.applied_at DESC
  LIMIT 1;

  price_cents := list_cents;
  IF list_cents IS NOT NULL AND promo_code IS NOT NULL THEN
    IF promo_percent IS NOT NULL THEN
      price_cents := (list_cents * (100 - promo_percent)) / 100;
    ELSE
      price_cents := GREATEST(list_cents - promo_amount, 0);
    END IF;
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
      WHEN promo_code IS NULL THEN NULL
      ELSE jsonb_build_object(
        'code', promo_code,
        'label', promo_label,
        'percent_off', promo_percent,
        'amount_off_cents', promo_amount,
        'ends_at', promo_ends
      )
    END
  );
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
  chosen TEXT;
  allowed BOOLEAN;
BEGIN
  target_firm := public.advisor_firm_id(true);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'Only a firm owner can change the plan';
  END IF;

  chosen := lower(COALESCE(target, ''));
  SELECT plan.selectable AND plan.monthly_cents IS NOT NULL
  INTO allowed
  FROM public.plans AS plan
  WHERE plan.code = chosen;

  IF NOT COALESCE(allowed, false) THEN
    RAISE EXCEPTION 'That plan is not open';
  END IF;

  UPDATE public.subscriptions AS subscription
  SET plan_code = chosen,
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

CREATE OR REPLACE FUNCTION public.apply_firm_promotion(promo_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_firm UUID;
  chosen_subscription UUID;
  current_plan TEXT;
  promo public.promotions%ROWTYPE;
  normalized TEXT;
BEGIN
  target_firm := public.advisor_firm_id(true);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'Only a firm owner can apply a promotion';
  END IF;

  normalized := upper(btrim(COALESCE(promo_code, '')));
  IF normalized = '' THEN
    RAISE EXCEPTION 'Enter a promotion code';
  END IF;

  SELECT * INTO promo
  FROM public.promotions AS promotion
  WHERE promotion.code = normalized;

  IF promo.code IS NULL OR NOT promo.active THEN
    RAISE EXCEPTION 'Unknown promotion';
  END IF;
  IF promo.starts_at IS NOT NULL AND promo.starts_at > timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'That promotion has not started';
  END IF;
  IF promo.ends_at IS NOT NULL AND promo.ends_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'That promotion has ended';
  END IF;

  SELECT subscription.id, subscription.plan_code
  INTO chosen_subscription, current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF chosen_subscription IS NULL THEN
    RAISE EXCEPTION 'No subscription found for this firm';
  END IF;
  IF NOT (current_plan = ANY (promo.applies_to)) THEN
    RAISE EXCEPTION 'That promotion does not apply to this plan';
  END IF;

  INSERT INTO public.subscription_promotions (subscription_id, promotion_code, ends_at)
  VALUES (chosen_subscription, promo.code, promo.ends_at)
  ON CONFLICT (subscription_id, promotion_code) DO UPDATE
  SET applied_at = timezone('utc'::text, now()),
      ends_at = EXCLUDED.ends_at;

  RETURN public.firm_subscription_quote();
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen_plan TEXT;
  firm_id UUID;
  current_plan TEXT;
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan NOT IN ('pro', 'pro_plus') THEN
    chosen_plan := 'free';
  END IF;

  INSERT INTO public.profiles (id, full_name, plan)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), chosen_plan)
  ON CONFLICT (id) DO NOTHING;

  firm_id := public.attach_shadow_firm(NEW.id);
  current_plan := public.ensure_firm_subscription(firm_id, chosen_plan);
  PERFORM set_config('macrorisk.plan_write', 'on', true);
  UPDATE public.profiles
  SET plan = current_plan
  WHERE id = NEW.id
    AND plan IS DISTINCT FROM current_plan;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_profile_plan() OWNER TO postgres;
ALTER FUNCTION public.ensure_firm_subscription(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.advisor_firm_id(BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.mirror_firm_plan(UUID) OWNER TO postgres;
ALTER FUNCTION public.firm_subscription_quote() OWNER TO postgres;
ALTER FUNCTION public.set_firm_plan(TEXT) OWNER TO postgres;
ALTER FUNCTION public.apply_firm_promotion(TEXT) OWNER TO postgres;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.protect_profile_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_firm_subscription(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advisor_firm_id(BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_firm_plan(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_firm_subscription(UUID, TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mirror_firm_plan(UUID) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.firm_subscription_quote() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.firm_subscription_quote() TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.set_firm_plan(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_firm_plan(TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.apply_firm_promotion(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_firm_promotion(TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

INSERT INTO public.subscriptions (firm_id, plan_code)
SELECT firm.id, COALESCE(
  (
    SELECT CASE
      WHEN profile.plan IN ('pro', 'pro_plus') THEN profile.plan
      ELSE 'free'
    END
    FROM public.firm_members AS member
    JOIN public.profiles AS profile ON profile.id = member.user_id
    WHERE member.firm_id = firm.id
      AND member.role = 'owner'
    ORDER BY member.created_at
    LIMIT 1
  ),
  'free'
)
FROM public.firms AS firm
ON CONFLICT (firm_id) DO NOTHING;

SELECT set_config('macrorisk.plan_write', 'on', true);
UPDATE public.profiles AS profile
SET plan = quoted.plan_code
FROM (
  SELECT DISTINCT ON (member.user_id)
    member.user_id,
    subscription.plan_code
  FROM public.firm_members AS member
  JOIN public.subscriptions AS subscription ON subscription.firm_id = member.firm_id
  ORDER BY member.user_id, (member.role = 'owner') DESC, member.created_at
) AS quoted
WHERE profile.id = quoted.user_id
  AND profile.plan IS DISTINCT FROM quoted.plan_code;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read plans" ON public.plans;
CREATE POLICY "Authenticated can read plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Members can view firm subscription" ON public.subscriptions;
CREATE POLICY "Members can view firm subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (firm_id IN (SELECT public.current_firm_ids()));

REVOKE ALL ON public.plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.promotions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.subscription_promotions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plans TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.plans TO service_role;
GRANT ALL ON public.subscriptions TO service_role;
GRANT ALL ON public.promotions TO service_role;
GRANT ALL ON public.subscription_promotions TO service_role;
