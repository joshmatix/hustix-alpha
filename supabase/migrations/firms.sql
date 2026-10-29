-- Portfolios belong to a firm. firm_members links advisors to firms (schema allows
-- multiple rows per user_id, but product policy is one sign-in email per firm).
-- Signup still creates one firm so a solo advisor has a place to put portfolios.

CREATE TABLE IF NOT EXISTS public.firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  report_header JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.firm_members (
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'advisor')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (firm_id, user_id)
);

DROP INDEX IF EXISTS public.firm_members_one_firm_per_advisor;

CREATE INDEX IF NOT EXISTS firm_members_user_id_idx
  ON public.firm_members (user_id);

CREATE INDEX IF NOT EXISTS firm_members_firm_id_idx
  ON public.firm_members (firm_id);

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_members ENABLE ROW LEVEL SECURITY;

-- Creates the caller's firm when signup did not. Not granted to clients
-- with an arbitrary user id, so an advisor cannot attach themselves to
-- someone else's firm.
CREATE OR REPLACE FUNCTION public.attach_shadow_firm(advisor_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing UUID;
  created UUID;
  firm_label TEXT;
BEGIN
  IF advisor_id IS NULL THEN
    RAISE EXCEPTION 'advisor_id is required';
  END IF;

  SELECT m.firm_id INTO existing
  FROM public.firm_members m
  WHERE m.user_id = advisor_id
  LIMIT 1;

  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.firm_name), ''), 'My firm')
  INTO firm_label
  FROM public.profiles p
  WHERE p.id = advisor_id;

  INSERT INTO public.firms (name)
  VALUES (COALESCE(firm_label, 'My firm'))
  RETURNING id INTO created;

  INSERT INTO public.firm_members (firm_id, user_id, role)
  VALUES (created, advisor_id, 'owner');

  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_shadow_firm()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN public.attach_shadow_firm(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.current_firm_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.firm_id
  FROM public.firm_members m
  WHERE m.user_id = auth.uid();
$$;

-- A solo advisor's settings label is that one firm's name. A shared firm,
-- or an advisor who belongs to more than one firm, is left unchanged.
CREATE OR REPLACE FUNCTION public.sync_sole_firm_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.firm_name IS NOT NULL AND btrim(NEW.firm_name) <> ''
     AND (TG_OP = 'INSERT' OR NEW.firm_name IS DISTINCT FROM OLD.firm_name) THEN
    UPDATE public.firms f
    SET name = btrim(NEW.firm_name)
    WHERE f.id IN (
      SELECT m.firm_id FROM public.firm_members m WHERE m.user_id = NEW.id
    )
    AND (
      SELECT count(*) FROM public.firm_members m2 WHERE m2.firm_id = f.id
    ) = 1
    AND (
      SELECT count(*) FROM public.firm_members m3 WHERE m3.user_id = NEW.id
    ) = 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_sole_firm_name ON public.profiles;
CREATE TRIGGER profiles_sync_sole_firm_name
  AFTER INSERT OR UPDATE OF firm_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_sole_firm_name();

-- Last member leaving removes the firm, and portfolios cascade with it.
CREATE OR REPLACE FUNCTION public.delete_empty_firm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.firms f
  WHERE f.id = OLD.firm_id
    AND NOT EXISTS (
      SELECT 1 FROM public.firm_members m WHERE m.firm_id = OLD.firm_id
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS firm_members_delete_empty_firm ON public.firm_members;
CREATE TRIGGER firm_members_delete_empty_firm
  AFTER DELETE ON public.firm_members
  FOR EACH ROW EXECUTE FUNCTION public.delete_empty_firm();

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

ALTER FUNCTION public.attach_shadow_firm(UUID) OWNER TO postgres;
ALTER FUNCTION public.ensure_shadow_firm() OWNER TO postgres;
ALTER FUNCTION public.current_firm_ids() OWNER TO postgres;
ALTER FUNCTION public.sync_sole_firm_name() OWNER TO postgres;
ALTER FUNCTION public.delete_empty_firm() OWNER TO postgres;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.attach_shadow_firm(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_shadow_firm(UUID) TO postgres, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION public.ensure_shadow_firm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_shadow_firm() TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.current_firm_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_firm_ids() TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.sync_sole_firm_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_empty_firm() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

INSERT INTO public.profiles (id, full_name)
SELECT id, COALESCE(raw_user_meta_data->>'full_name', '')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  advisor RECORD;
BEGIN
  FOR advisor IN
    SELECT u.id
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.firm_members m WHERE m.user_id = u.id
    )
  LOOP
    PERFORM public.attach_shadow_firm(advisor.id);
  END LOOP;
END $$;

ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS firm_id UUID;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS created_by UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios' AND column_name = 'user_id'
  ) THEN
    UPDATE public.portfolios p
    SET firm_id = m.firm_id,
        created_by = COALESCE(p.created_by, p.user_id)
    FROM public.firm_members m
    WHERE p.user_id = m.user_id
      AND p.firm_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.portfolios WHERE firm_id IS NULL) THEN
    RAISE EXCEPTION 'portfolios remain without a firm';
  END IF;
END $$;

ALTER TABLE public.portfolios ALTER COLUMN firm_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_firm_id_fkey'
  ) THEN
    ALTER TABLE public.portfolios
      ADD CONSTRAINT portfolios_firm_id_fkey
      FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_created_by_fkey'
  ) THEN
    ALTER TABLE public.portfolios
      ADD CONSTRAINT portfolios_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS portfolios_firm_id_idx ON public.portfolios (firm_id);

DROP POLICY IF EXISTS "Advisors can manage own client portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can manage own holdings" ON public.portfolio_holdings;

ALTER TABLE public.portfolios DROP COLUMN IF EXISTS user_id;

DROP POLICY IF EXISTS "Advisors can manage firm portfolios" ON public.portfolios;
CREATE POLICY "Advisors can manage firm portfolios"
  ON public.portfolios FOR ALL
  TO authenticated
  USING (firm_id IN (SELECT public.current_firm_ids()))
  WITH CHECK (firm_id IN (SELECT public.current_firm_ids()));

DROP POLICY IF EXISTS "Advisors can manage firm holdings" ON public.portfolio_holdings;
CREATE POLICY "Advisors can manage firm holdings"
  ON public.portfolio_holdings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND p.firm_id IN (SELECT public.current_firm_ids())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND p.firm_id IN (SELECT public.current_firm_ids())
    )
  );

DROP POLICY IF EXISTS "Members can view their firm" ON public.firms;
CREATE POLICY "Members can view their firm"
  ON public.firms FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.current_firm_ids()));

DROP POLICY IF EXISTS "Advisors can view own membership" ON public.firm_members;
CREATE POLICY "Advisors can view own membership"
  ON public.firm_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.firms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.firm_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.firms TO authenticated;
GRANT SELECT ON public.firm_members TO authenticated;
GRANT ALL ON public.firms TO service_role;
GRANT ALL ON public.firm_members TO service_role;

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS report_header JSONB NOT NULL DEFAULT '{}'::jsonb;
