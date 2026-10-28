-- One lead advisor per portfolio. Keep portfolios.created_by aligned with the lead.

ALTER TABLE public.portfolio_advisors
  ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_advisors_one_lead_idx
  ON public.portfolio_advisors (portfolio_id)
  WHERE is_lead;

-- Existing rows: treat created_by as the lead when present, otherwise the
-- earliest assignee.
UPDATE public.portfolio_advisors AS assignment
SET is_lead = true
WHERE assignment.ctid IN (
  SELECT pick.ctid
  FROM (
    SELECT
      pa.ctid,
      ROW_NUMBER() OVER (
        PARTITION BY pa.portfolio_id
        ORDER BY
          (pa.user_id = portfolio.created_by) DESC,
          pa.created_at,
          pa.user_id
      ) AS rank
    FROM public.portfolio_advisors AS pa
    JOIN public.portfolios AS portfolio ON portfolio.id = pa.portfolio_id
  ) AS pick
  WHERE pick.rank = 1
)
AND NOT EXISTS (
  SELECT 1
  FROM public.portfolio_advisors AS existing
  WHERE existing.portfolio_id = assignment.portfolio_id
    AND existing.is_lead
);

CREATE OR REPLACE FUNCTION public.sync_portfolio_lead(target_portfolio UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lead_user UUID;
BEGIN
  SELECT assignment.user_id
  INTO lead_user
  FROM public.portfolio_advisors AS assignment
  WHERE assignment.portfolio_id = target_portfolio
    AND assignment.is_lead
  LIMIT 1;

  IF lead_user IS NULL THEN
    SELECT assignment.user_id
    INTO lead_user
    FROM public.portfolio_advisors AS assignment
    WHERE assignment.portfolio_id = target_portfolio
    ORDER BY assignment.created_at, assignment.user_id
    LIMIT 1;

    IF lead_user IS NOT NULL THEN
      UPDATE public.portfolio_advisors
      SET is_lead = (user_id = lead_user)
      WHERE portfolio_id = target_portfolio;
    END IF;
  END IF;

  IF lead_user IS NOT NULL THEN
    UPDATE public.portfolios
    SET created_by = lead_user
    WHERE id = target_portfolio;
  END IF;
END;
$$;

ALTER FUNCTION public.sync_portfolio_lead(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_portfolio_lead(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_portfolio_lead(UUID) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.admin_add_firm_advisor(
  target_firm UUID,
  advisor_email TEXT,
  advisor_name TEXT DEFAULT NULL,
  advisor_role TEXT DEFAULT 'advisor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  email_norm TEXT;
  role_norm TEXT;
  advisor_user UUID;
  firm_label TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.firms WHERE id = target_firm) THEN
    RAISE EXCEPTION 'Unknown firm';
  END IF;

  email_norm := lower(btrim(COALESCE(advisor_email, '')));
  IF email_norm = '' OR email_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid advisor email is required';
  END IF;

  role_norm := lower(btrim(COALESCE(advisor_role, 'advisor')));
  IF role_norm NOT IN ('owner', 'advisor') THEN
    role_norm := 'advisor';
  END IF;

  SELECT account_user.id
  INTO advisor_user
  FROM auth.users AS account_user
  WHERE lower(account_user.email) = email_norm
    AND account_user.deleted_at IS NULL
  LIMIT 1;

  IF advisor_user IS NULL THEN
    RAISE EXCEPTION 'No account for %. Sign up that user first.', email_norm;
  END IF;

  SELECT firm.name INTO firm_label FROM public.firms AS firm WHERE firm.id = target_firm;

  UPDATE public.profiles
  SET
    full_name = COALESCE(NULLIF(btrim(advisor_name), ''), full_name),
    firm_name = firm_label
  WHERE id = advisor_user;

  INSERT INTO public.firm_members (firm_id, user_id, role)
  VALUES (target_firm, advisor_user, role_norm)
  ON CONFLICT (firm_id, user_id) DO UPDATE
  SET role = EXCLUDED.role;

  RETURN jsonb_build_object('user_id', advisor_user::text, 'firm_id', target_firm::text);
END;
$$;

ALTER FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.admin_assign_portfolio_advisor(
  target_portfolio UUID,
  target_user UUID,
  make_lead BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  firm_id UUID;
  has_lead BOOLEAN;
BEGIN
  SELECT portfolio.firm_id
  INTO firm_id
  FROM public.portfolios AS portfolio
  WHERE portfolio.id = target_portfolio;

  IF firm_id IS NULL THEN
    RAISE EXCEPTION 'Unknown portfolio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.firm_members AS member
    WHERE member.firm_id = firm_id
      AND member.user_id = target_user
  ) THEN
    RAISE EXCEPTION 'Advisor must belong to the portfolio firm';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.portfolio_advisors AS assignment
    WHERE assignment.portfolio_id = target_portfolio
      AND assignment.is_lead
  ) INTO has_lead;

  INSERT INTO public.portfolio_advisors (portfolio_id, user_id, is_lead)
  VALUES (
    target_portfolio,
    target_user,
    make_lead OR NOT has_lead
  )
  ON CONFLICT (portfolio_id, user_id) DO UPDATE
  SET is_lead = CASE
    WHEN make_lead THEN true
    ELSE public.portfolio_advisors.is_lead
  END;

  IF make_lead OR NOT has_lead THEN
    UPDATE public.portfolio_advisors
    SET is_lead = (user_id = target_user)
    WHERE portfolio_id = target_portfolio;
  END IF;

  PERFORM public.sync_portfolio_lead(target_portfolio);

  RETURN jsonb_build_object(
    'portfolio_id', target_portfolio::text,
    'user_id', target_user::text
  );
END;
$$;

ALTER FUNCTION public.admin_assign_portfolio_advisor(UUID, UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_assign_portfolio_advisor(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_portfolio_advisor(UUID, UUID, BOOLEAN) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.admin_remove_portfolio_advisor(
  target_portfolio UUID,
  target_user UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  remaining INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_advisors AS assignment
    WHERE assignment.portfolio_id = target_portfolio
      AND assignment.user_id = target_user
  ) THEN
    RAISE EXCEPTION 'Advisor is not assigned to this portfolio';
  END IF;

  SELECT count(*)::int
  INTO remaining
  FROM public.portfolio_advisors AS assignment
  WHERE assignment.portfolio_id = target_portfolio;

  IF remaining <= 1 THEN
    RAISE EXCEPTION 'A portfolio needs at least one advisor';
  END IF;

  DELETE FROM public.portfolio_advisors
  WHERE portfolio_id = target_portfolio
    AND user_id = target_user;

  PERFORM public.sync_portfolio_lead(target_portfolio);

  RETURN jsonb_build_object(
    'portfolio_id', target_portfolio::text,
    'user_id', target_user::text
  );
END;
$$;

ALTER FUNCTION public.admin_remove_portfolio_advisor(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_remove_portfolio_advisor(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_portfolio_advisor(UUID, UUID) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
