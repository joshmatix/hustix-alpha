-- Operator console: permanently remove a firm and cascaded data.

CREATE OR REPLACE FUNCTION public.admin_delete_firm(target_firm UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  firm_label TEXT;
BEGIN
  SELECT firm.name
  INTO firm_label
  FROM public.firms AS firm
  WHERE firm.id = target_firm;

  IF firm_label IS NULL THEN
    RAISE EXCEPTION 'Unknown firm';
  END IF;

  DELETE FROM public.firms WHERE id = target_firm;

  RETURN jsonb_build_object('firm_id', target_firm::text, 'name', firm_label);
END;
$$;

ALTER FUNCTION public.admin_delete_firm(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_delete_firm(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_firm(UUID) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
