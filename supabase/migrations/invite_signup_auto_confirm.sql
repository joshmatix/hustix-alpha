-- Invited advisors: skip Supabase email confirmation when signing up with a pending firm invite.
-- Self-serve signups still require confirmation (enable_confirmations stays on).

CREATE OR REPLACE FUNCTION public.auto_confirm_firm_invite_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.firm_advisor_invites AS invite
    WHERE lower(invite.email) = lower(NEW.email)
      AND invite.accepted_at IS NULL
  ) THEN
    NEW.email_confirmed_at := COALESCE(
      NEW.email_confirmed_at,
      timezone('utc'::text, now())
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.auto_confirm_firm_invite_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_confirm_firm_invite_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_firm_invite_user() TO supabase_auth_admin, postgres, service_role;

DROP TRIGGER IF EXISTS on_auth_user_firm_invite_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_firm_invite_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_firm_invite_user();

-- Signup page: prefill firm/name from a pending invite (no auth required).
CREATE OR REPLACE FUNCTION public.pending_firm_invite_signup_hint(target_email text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT jsonb_build_object(
    'firm_name', firm.name,
    'full_name', invite.full_name
  )
  FROM public.firm_advisor_invites AS invite
  INNER JOIN public.firms AS firm ON firm.id = invite.firm_id
  WHERE lower(invite.email) = lower(btrim(COALESCE(target_email, '')))
    AND invite.accepted_at IS NULL
    AND btrim(COALESCE(target_email, '')) <> ''
  ORDER BY invite.invited_at DESC
  LIMIT 1;
$$;

ALTER FUNCTION public.pending_firm_invite_signup_hint(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pending_firm_invite_signup_hint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_firm_invite_signup_hint(text) TO anon, authenticated, postgres, service_role;
