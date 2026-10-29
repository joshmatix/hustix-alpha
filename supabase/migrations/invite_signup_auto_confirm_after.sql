-- GoTrue may ignore BEFORE INSERT changes to email_confirmed_at; confirm after row exists.

CREATE OR REPLACE FUNCTION public.auto_confirm_firm_invite_user_after()
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
  ) THEN
    UPDATE auth.users AS account_user
    SET email_confirmed_at = COALESCE(
      account_user.email_confirmed_at,
      timezone('utc'::text, now())
    )
    WHERE account_user.id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.auto_confirm_firm_invite_user_after() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_confirm_firm_invite_user_after() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_firm_invite_user_after() TO supabase_auth_admin, postgres, service_role;

DROP TRIGGER IF EXISTS on_auth_user_firm_invite_auto_confirm_after ON auth.users;
CREATE TRIGGER on_auth_user_firm_invite_auto_confirm_after
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_firm_invite_user_after();
