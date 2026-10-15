-- Account plan chosen at signup. Existing advisors stay on free.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'pro'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen_plan TEXT;
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan <> 'pro' THEN
    chosen_plan := 'free';
  END IF;

  INSERT INTO public.profiles (id, full_name, plan)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), chosen_plan)
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.attach_shadow_firm(NEW.id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;
