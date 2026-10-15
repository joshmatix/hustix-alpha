-- Pro+ sits above Pro. Pro holds 100 portfolios per advisor. Pro+ does not.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%enterprise%'
      AND rel.relname IN ('plans', 'promotions', 'profiles')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      (
        SELECT rel.relname
        FROM pg_constraint AS con
        JOIN pg_class AS rel ON rel.oid = con.conrelid
        WHERE con.conname = constraint_name
        LIMIT 1
      ),
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_code_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_code_check
  CHECK (code IN ('free', 'pro', 'pro_plus', 'enterprise'));

ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_applies_to_check;
ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_applies_to_check
  CHECK (applies_to <@ ARRAY['free', 'pro', 'pro_plus', 'enterprise']::TEXT[]);

ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_applies_to_cardinality_check;
ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_applies_to_cardinality_check
  CHECK (cardinality(applies_to) > 0);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'pro', 'pro_plus', 'enterprise'));

INSERT INTO public.plans (code, name, monthly_cents, additional_seat_cents, selectable)
VALUES ('pro_plus', 'Pro+', 19900, 9900, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    monthly_cents = EXCLUDED.monthly_cents,
    additional_seat_cents = EXCLUDED.additional_seat_cents,
    selectable = EXCLUDED.selectable;

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

ALTER FUNCTION public.ensure_firm_subscription(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
ALTER FUNCTION public.enforce_free_portfolio_limit() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ensure_firm_subscription(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_firm_subscription(UUID, TEXT) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

REVOKE ALL ON FUNCTION public.enforce_free_portfolio_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_portfolio_limit() TO postgres, service_role;
