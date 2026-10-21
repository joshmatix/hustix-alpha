-- Advisor management for the admin screen.
-- service_role is the only caller of the admin functions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION public.account_disabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.disabled_at IS NOT NULL
  );
$$;

ALTER FUNCTION public.account_disabled() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_disabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_disabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_directory()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT json_build_object(
    'advisors', COALESCE((
      SELECT json_agg(json_build_object(
        'id', advisor.id,
        'email', advisor.email,
        'full_name', advisor.full_name,
        'phone', advisor.phone,
        'firm_name', advisor.firm_name,
        'enabled', advisor.enabled,
        'plan_code', advisor.plan_code,
        'promotion_code', advisor.promotion_code,
        'promotion_label', advisor.promotion_label,
        'percent_off', advisor.percent_off,
        'amount_off_cents', advisor.amount_off_cents,
        'promotion_starts_on', advisor.promotion_starts_on,
        'promotion_ends_on', advisor.promotion_ends_on,
        'agreement_version', advisor.agreement_version,
        'agreement_signed_at', advisor.agreement_signed_at,
        'last_seen', advisor.last_seen
      ) ORDER BY advisor.full_name, advisor.email)
      FROM (
        SELECT
          account_user.id,
          COALESCE(account_user.email, '') AS email,
          COALESCE(profile.full_name, '') AS full_name,
          COALESCE(profile.phone, '') AS phone,
          COALESCE(profile.firm_name, '') AS firm_name,
          profile.disabled_at IS NULL AS enabled,
          COALESCE(subscription.plan_code, profile.plan, 'free') AS plan_code,
          COALESCE(promo.code, '') AS promotion_code,
          COALESCE(promo.label, '') AS promotion_label,
          promo.percent_off,
          promo.amount_off_cents,
          promo.starts_on AS promotion_starts_on,
          promo.ends_on AS promotion_ends_on,
          COALESCE(acceptance.version, '') AS agreement_version,
          acceptance.signed_at AS agreement_signed_at,
          seen.last_seen
        FROM auth.users AS account_user
        JOIN public.profiles AS profile ON profile.id = account_user.id
        LEFT JOIN LATERAL (
          SELECT member.firm_id
          FROM public.firm_members AS member
          WHERE member.user_id = account_user.id
          ORDER BY (member.role = 'owner') DESC, member.created_at
          LIMIT 1
        ) AS membership ON true
        LEFT JOIN public.subscriptions AS subscription
          ON subscription.firm_id = membership.firm_id
        LEFT JOIN LATERAL (
          SELECT promotion.code, promotion.label, promotion.percent_off, promotion.amount_off_cents,
            to_char(promotion.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS starts_on,
            to_char(COALESCE(applied.ends_at, promotion.ends_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ends_on
          FROM public.subscription_promotions AS applied
          JOIN public.promotions AS promotion ON promotion.code = applied.promotion_code
          WHERE applied.subscription_id = subscription.id
            AND promotion.active
            AND (applied.ends_at IS NULL OR applied.ends_at > timezone('utc'::text, now()))
          ORDER BY applied.applied_at DESC
          LIMIT 1
        ) AS promo ON true
        LEFT JOIN LATERAL (
          SELECT published.version, accepted.signed_at
          FROM public.agreement_acceptances AS accepted
          JOIN public.agreement_versions AS published ON published.id = accepted.agreement_id
          WHERE accepted.user_id = account_user.id
          ORDER BY accepted.signed_at DESC, accepted.id DESC
          LIMIT 1
        ) AS acceptance ON true
        LEFT JOIN LATERAL (
          SELECT to_char(
            max(COALESCE(session.updated_at, session.created_at)) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS last_seen
          FROM auth.sessions AS session
          WHERE session.user_id = account_user.id
        ) AS seen ON true
        WHERE account_user.deleted_at IS NULL
      ) AS advisor
    ), '[]'::json),
    'promotions', COALESCE((
      SELECT json_agg(json_build_object(
        'code', promotion.code,
        'label', promotion.label,
        'percent_off', promotion.percent_off,
        'amount_off_cents', promotion.amount_off_cents,
        'applies_to', promotion.applies_to,
        'active', promotion.active,
        'starts_at', to_char(promotion.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        'ends_at', to_char(promotion.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ) ORDER BY promotion.code)
      FROM public.promotions AS promotion
      WHERE promotion.active
    ), '[]'::json)
  );
$$;

CREATE OR REPLACE FUNCTION public._admin_advisor_firm(target_user UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT member.firm_id
  FROM public.firm_members AS member
  WHERE member.user_id = target_user
  ORDER BY (member.role = 'owner') DESC, member.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_advisor_access(target_user UUID, enabled BOOLEAN)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'Unknown advisor';
  END IF;

  UPDATE public.profiles
  SET disabled_at = CASE
    WHEN enabled THEN NULL
    ELSE timezone('utc'::text, now())
  END
  WHERE id = target_user;

  UPDATE auth.users
  SET banned_until = CASE
    WHEN enabled THEN NULL
    ELSE timezone('utc'::text, now()) + interval '100 years'
  END
  WHERE id = target_user;

  RETURN public.admin_directory();
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
  VALUES (target_firm, chosen, 'active')
  ON CONFLICT (firm_id) DO UPDATE
  SET plan_code = EXCLUDED.plan_code,
      status = 'active',
      ends_at = NULL;

  PERFORM public.mirror_firm_plan(target_firm);
  RETURN public.admin_directory();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_advisor_promotion(target_user UUID, promo_code TEXT)
RETURNS json
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'Unknown advisor';
  END IF;

  target_firm := public._admin_advisor_firm(target_user);
  IF target_firm IS NULL THEN
    RAISE EXCEPTION 'This advisor has no firm';
  END IF;

  SELECT subscription.id, subscription.plan_code
  INTO chosen_subscription, current_plan
  FROM public.subscriptions AS subscription
  WHERE subscription.firm_id = target_firm;

  IF chosen_subscription IS NULL THEN
    RAISE EXCEPTION 'No subscription found for this firm';
  END IF;

  normalized := upper(btrim(COALESCE(promo_code, '')));
  IF normalized = '' THEN
    DELETE FROM public.subscription_promotions
    WHERE subscription_id = chosen_subscription;
    RETURN public.admin_directory();
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
  IF NOT (current_plan = ANY (promo.applies_to)) THEN
    RAISE EXCEPTION 'That promotion does not apply to this plan';
  END IF;

  INSERT INTO public.subscription_promotions (subscription_id, promotion_code, ends_at)
  VALUES (chosen_subscription, promo.code, promo.ends_at)
  ON CONFLICT (subscription_id, promotion_code) DO UPDATE
  SET applied_at = timezone('utc'::text, now()),
      ends_at = EXCLUDED.ends_at;

  RETURN public.admin_directory();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_advisor_contact(
  target_user UUID,
  next_name TEXT,
  next_firm TEXT,
  next_phone TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_name TEXT;
  clean_firm TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'Unknown advisor';
  END IF;

  clean_name := btrim(COALESCE(next_name, ''));
  clean_firm := btrim(COALESCE(next_firm, ''));
  IF clean_name = '' THEN
    RAISE EXCEPTION 'Enter the advisor name';
  END IF;
  IF clean_firm = '' THEN
    RAISE EXCEPTION 'Enter the firm name';
  END IF;

  UPDATE public.profiles
  SET full_name = clean_name,
      firm_name = clean_firm,
      phone = NULLIF(btrim(COALESCE(next_phone, '')), '')
  WHERE id = target_user;

  RETURN public.admin_directory();
END;
$$;

DROP FUNCTION IF EXISTS public.admin_upsert_promotion(TEXT, TEXT, INTEGER, INTEGER, TEXT[]);
DROP FUNCTION IF EXISTS public.admin_upsert_promotion(TEXT, TEXT, INTEGER, INTEGER, TEXT[], DATE);

CREATE OR REPLACE FUNCTION public.admin_upsert_promotion(
  promo_code TEXT,
  promo_label TEXT,
  percent_off INTEGER,
  amount_off_cents INTEGER,
  applies_to TEXT[],
  starts_on DATE,
  expires_on DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized TEXT;
  clean_label TEXT;
  plans TEXT[];
BEGIN
  normalized := upper(btrim(COALESCE(promo_code, '')));
  clean_label := btrim(COALESCE(promo_label, ''));
  IF normalized = '' OR normalized !~ '^[A-Z0-9_-]{2,32}$' THEN
    RAISE EXCEPTION 'Use a short promotion code';
  END IF;
  IF clean_label = '' THEN
    clean_label := normalized;
  END IF;
  IF (percent_off IS NULL) = (amount_off_cents IS NULL) THEN
    RAISE EXCEPTION 'Set a percent off or an amount off';
  END IF;
  IF percent_off IS NOT NULL AND (percent_off < 1 OR percent_off > 100) THEN
    RAISE EXCEPTION 'Percent off must be from 1 to 100';
  END IF;
  IF amount_off_cents IS NOT NULL AND amount_off_cents < 1 THEN
    RAISE EXCEPTION 'Amount off must be at least one cent';
  END IF;
  IF starts_on IS NULL OR expires_on IS NULL THEN
    RAISE EXCEPTION 'Choose a start date and an end date';
  END IF;
  IF starts_on < (timezone('utc'::text, now()))::date THEN
    RAISE EXCEPTION 'The start date must be today or later';
  END IF;
  IF expires_on < starts_on THEN
    RAISE EXCEPTION 'The end date must be on or after the start date';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT plan_code), ARRAY[]::TEXT[])
  INTO plans
  FROM unnest(COALESCE(applies_to, ARRAY[]::TEXT[])) AS plan_code
  WHERE plan_code IN ('free', 'pro', 'pro_plus', 'enterprise');

  IF cardinality(plans) = 0 THEN
    RAISE EXCEPTION 'Choose at least one plan';
  END IF;

  INSERT INTO public.promotions (code, label, percent_off, amount_off_cents, applies_to, active, starts_at, ends_at)
  VALUES (
    normalized,
    clean_label,
    percent_off,
    amount_off_cents,
    plans,
    true,
    starts_on::timestamp AT TIME ZONE 'UTC',
    (expires_on + time '23:59:59')::timestamp AT TIME ZONE 'UTC'
  )
  ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      percent_off = EXCLUDED.percent_off,
      amount_off_cents = EXCLUDED.amount_off_cents,
      applies_to = EXCLUDED.applies_to,
      active = true,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at;

  RETURN public.admin_directory();
END;
$$;

ALTER FUNCTION public.admin_directory() OWNER TO postgres;
ALTER FUNCTION public._admin_advisor_firm(UUID) OWNER TO postgres;
ALTER FUNCTION public.admin_set_advisor_access(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.admin_set_advisor_plan(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_set_advisor_promotion(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_update_advisor_contact(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_upsert_promotion(TEXT, TEXT, INTEGER, INTEGER, TEXT[], DATE, DATE) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_directory() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_advisor_firm(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_advisor_access(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_advisor_plan(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_advisor_promotion(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_advisor_contact(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_promotion(TEXT, TEXT, INTEGER, INTEGER, TEXT[], DATE, DATE) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_directory() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_advisor_access(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_advisor_plan(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_advisor_promotion(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_advisor_contact(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_promotion(TEXT, TEXT, INTEGER, INTEGER, TEXT[], DATE, DATE) TO service_role;
