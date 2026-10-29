-- Operator console: permanently remove an auth user and cascaded profile data.

CREATE OR REPLACE FUNCTION public.admin_delete_advisor(target_user UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_email TEXT;
BEGIN
  SELECT account_user.email
  INTO user_email
  FROM auth.users AS account_user
  WHERE account_user.id = target_user
    AND account_user.deleted_at IS NULL;

  IF user_email IS NULL THEN
    RAISE EXCEPTION 'Unknown advisor';
  END IF;

  DELETE FROM auth.users AS account_user
  WHERE account_user.id = target_user;

  RETURN jsonb_build_object(
    'user_id', target_user::text,
    'email', user_email
  );
END;
$$;

ALTER FUNCTION public.admin_delete_advisor(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_delete_advisor(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_advisor(UUID) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
