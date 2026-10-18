-- Signup stores the firm name on the profile before the firm row is created.

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
  accepted_at TEXT;
  firm_label TEXT;
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan NOT IN ('pro', 'pro_plus') THEN
    chosen_plan := 'free';
  END IF;

  accepted_at := NULLIF(NEW.raw_user_meta_data->>'agreement_accepted_at', '');
  firm_label := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'firm_name', '')), '');

  INSERT INTO public.profiles (
    id,
    full_name,
    firm_name,
    plan,
    agreement_version,
    agreement_accepted_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    firm_label,
    chosen_plan,
    NULLIF(NEW.raw_user_meta_data->>'agreement_version', ''),
    CASE
      WHEN accepted_at IS NULL THEN NULL
      ELSE accepted_at::timestamp with time zone
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET firm_name = COALESCE(EXCLUDED.firm_name, public.profiles.firm_name);

  firm_id := public.attach_shadow_firm(NEW.id);
  IF firm_label IS NOT NULL THEN
    UPDATE public.firms
    SET name = firm_label
    WHERE id = firm_id;
  END IF;

  current_plan := public.ensure_firm_subscription(firm_id, chosen_plan);
  PERFORM set_config('macrorisk.plan_write', 'on', true);
  UPDATE public.profiles
  SET plan = current_plan
  WHERE id = NEW.id
    AND plan IS DISTINCT FROM current_plan;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;
