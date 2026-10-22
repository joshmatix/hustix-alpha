-- One row per time an advisor accepts a published agreement.
-- The profile no longer stores a single version. A new agreement is accepted
-- by inserting another row here. Existing rows stay as signed.

ALTER TABLE public.agreement_versions
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

ALTER TABLE public.agreement_versions
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agreement_versions_id_key
  ON public.agreement_versions (id);

CREATE TABLE IF NOT EXISTS public.agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES public.agreement_versions (id),
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  ip_address INET
);

CREATE INDEX IF NOT EXISTS agreement_acceptances_user_idx
  ON public.agreement_acceptances (user_id, agreement_id, signed_at DESC);

CREATE OR REPLACE FUNCTION public.protect_agreement_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A recorded agreement acceptance cannot be changed';
END;
$$;

DROP TRIGGER IF EXISTS agreement_acceptances_immutable ON public.agreement_acceptances;
CREATE TRIGGER agreement_acceptances_immutable
  BEFORE UPDATE ON public.agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.protect_agreement_acceptance();

ALTER FUNCTION public.protect_agreement_acceptance() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_agreement_acceptance() FROM PUBLIC, anon, authenticated;

-- Address recorded by the API for this request. The browser does not supply it.
CREATE OR REPLACE FUNCTION public.request_client_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  raw_headers text;
  headers json;
  candidate text;
BEGIN
  raw_headers := current_setting('request.headers', true);
  IF raw_headers IS NOT NULL AND btrim(raw_headers) <> '' THEN
    BEGIN
      headers := raw_headers::json;
    EXCEPTION WHEN others THEN
      headers := NULL;
    END;
  END IF;

  IF headers IS NOT NULL THEN
    candidate := NULLIF(btrim(split_part(COALESCE(headers->>'x-forwarded-for', ''), ',', 1)), '');
    IF candidate IS NOT NULL THEN
      BEGIN
        RETURN candidate::inet;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    candidate := NULLIF(btrim(COALESCE(headers->>'x-real-ip', '')), '');
    IF candidate IS NOT NULL THEN
      BEGIN
        RETURN candidate::inet;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN inet_client_addr();
END;
$$;

ALTER FUNCTION public.request_client_ip() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_client_ip() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_agreement(target_version text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  published_id uuid;
  acceptance_id uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign in before accepting the agreement';
  END IF;

  SELECT published.id
  INTO published_id
  FROM public.agreement_versions AS published
  WHERE published.version = NULLIF(btrim(COALESCE(target_version, '')), '');

  IF published_id IS NULL THEN
    RAISE EXCEPTION 'That agreement version is not published';
  END IF;

  INSERT INTO public.agreement_acceptances (user_id, agreement_id, signed_at, ip_address)
  VALUES (actor, published_id, timezone('utc'::text, now()), public.request_client_ip())
  RETURNING id INTO acceptance_id;

  RETURN acceptance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_accepted_current_agreement()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT accepted.agreement_id = (
        SELECT current_version.id
        FROM public.agreement_versions AS current_version
        ORDER BY current_version.published_at DESC, current_version.version DESC
        LIMIT 1
      )
      FROM public.agreement_acceptances AS accepted
      WHERE accepted.user_id = auth.uid()
      ORDER BY accepted.signed_at DESC, accepted.id DESC
      LIMIT 1
    ),
    false
  );
$$;

ALTER FUNCTION public.accept_agreement(text) OWNER TO postgres;
ALTER FUNCTION public.has_accepted_current_agreement() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_agreement(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_accepted_current_agreement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_agreement(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_accepted_current_agreement() TO authenticated;

ALTER TABLE public.agreement_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors can read their own acceptances" ON public.agreement_acceptances;
CREATE POLICY "Advisors can read their own acceptances"
  ON public.agreement_acceptances
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.agreement_acceptances TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agreement_acceptances FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'agreement_version'
  ) THEN
    INSERT INTO public.agreement_acceptances (user_id, agreement_id, signed_at, ip_address)
    SELECT profile.id,
           published.id,
           COALESCE(profile.agreement_accepted_at, profile.updated_at),
           NULL
    FROM public.profiles AS profile
    JOIN public.agreement_versions AS published
      ON published.version = profile.agreement_version
    WHERE profile.agreement_version IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agreement_acceptances AS existing
        WHERE existing.user_id = profile.id
          AND existing.agreement_id = published.id
      );
  END IF;
END $$;

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
  firm_label TEXT;
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan NOT IN ('pro', 'pro_plus') THEN
    chosen_plan := 'free';
  END IF;

  firm_label := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'firm_name', '')), '');

  INSERT INTO public.profiles (
    id,
    full_name,
    firm_name,
    plan
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    firm_label,
    chosen_plan
  )
  ON CONFLICT (id) DO UPDATE
  SET firm_name = COALESCE(EXCLUDED.firm_name, public.profiles.firm_name),
      full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name);

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

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_agreement_version_fkey;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS agreement_version;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS agreement_accepted_at;
