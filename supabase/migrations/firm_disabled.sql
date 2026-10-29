-- Firm-level disable cascades to member advisors. Re-enabling a firm does not
-- re-enable advisors; use admin_set_advisor_access for each account.

ALTER TABLE public.firms
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
  )
  OR EXISTS (
    SELECT 1
    FROM public.firm_members AS member
    JOIN public.firms AS firm ON firm.id = member.firm_id
    WHERE member.user_id = auth.uid()
      AND firm.disabled_at IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_set_firm_access(target_firm UUID, enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.firms WHERE id = target_firm) THEN
    RAISE EXCEPTION 'Unknown firm';
  END IF;

  UPDATE public.firms
  SET disabled_at = CASE
    WHEN enabled THEN NULL
    ELSE timezone('utc'::text, now())
  END
  WHERE id = target_firm;

  IF NOT enabled THEN
    UPDATE public.profiles AS profile
    SET disabled_at = timezone('utc'::text, now())
    FROM public.firm_members AS member
    WHERE member.firm_id = target_firm
      AND member.user_id = profile.id
      AND profile.disabled_at IS NULL;

    UPDATE auth.users AS account_user
    SET banned_until = timezone('utc'::text, now()) + interval '100 years'
    FROM public.firm_members AS member
    WHERE member.firm_id = target_firm
      AND member.user_id = account_user.id;
  END IF;
END;
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

  IF enabled AND EXISTS (
    SELECT 1
    FROM public.firm_members AS member
    JOIN public.firms AS firm ON firm.id = member.firm_id
    WHERE member.user_id = target_user
      AND firm.disabled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Enable the firm before enabling this advisor';
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

ALTER FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
