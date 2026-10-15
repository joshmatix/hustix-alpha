-- Profile page can replace the firm's report header. Members can already
-- read the firm. This is the only client write, and it cannot rename the firm.

CREATE OR REPLACE FUNCTION public.set_report_header(header JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF header IS NULL OR jsonb_typeof(header) <> 'object' THEN
    RAISE EXCEPTION 'Report header must be a JSON object';
  END IF;
  IF octet_length(header::text) > 100000 THEN
    RAISE EXCEPTION 'Report header is too large';
  END IF;

  UPDATE public.firms AS firm
  SET report_header = header
  WHERE firm.id IN (
    SELECT member.firm_id
    FROM public.firm_members AS member
    WHERE member.user_id = auth.uid()
      AND member.role = 'owner'
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No firm found for this account';
  END IF;

  RETURN header;
END;
$$;

ALTER FUNCTION public.set_report_header(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_report_header(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_header(JSONB) TO authenticated, service_role, postgres;
