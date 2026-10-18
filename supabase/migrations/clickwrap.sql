-- Records the customer-agreement version accepted at signup.
-- Run once on the hosted database.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMP WITH TIME ZONE;

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
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan NOT IN ('pro', 'pro_plus') THEN
    chosen_plan := 'free';
  END IF;

  accepted_at := NULLIF(NEW.raw_user_meta_data->>'agreement_accepted_at', '');

  INSERT INTO public.profiles (
    id,
    full_name,
    plan,
    agreement_version,
    agreement_accepted_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    chosen_plan,
    NULLIF(NEW.raw_user_meta_data->>'agreement_version', ''),
    CASE
      WHEN accepted_at IS NULL THEN NULL
      ELSE accepted_at::timestamp with time zone
    END
  )
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

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;
