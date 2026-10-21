-- Login compares the advisor's latest acceptance with the current agreement.
-- An older signature stays on file. It does not satisfy a newer version.

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

ALTER FUNCTION public.has_accepted_current_agreement() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_accepted_current_agreement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_accepted_current_agreement() TO authenticated;
