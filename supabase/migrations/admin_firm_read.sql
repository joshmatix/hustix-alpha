-- Hosted admin: list firms and read firm detail (mirrors admin/server.py).
-- Firm enable/disable uses firms.disabled_at (full behavior in firm_disabled.sql).

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION public.admin_firms_list()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row ORDER BY row.name), '[]'::json)
  FROM (
    SELECT
      firm.id::text AS id,
      firm.name,
      COALESCE(subscription.plan_code, 'free') AS plan_code,
      COALESCE(subscription.status, '') AS subscription_status,
      (firm.disabled_at IS NULL) AS enabled,
      (
        SELECT count(*)::int
        FROM public.firm_members AS member
        WHERE member.firm_id = firm.id
      ) AS member_count,
      (
        SELECT count(*)::int
        FROM public.portfolios AS portfolio
        WHERE portfolio.firm_id = firm.id
      ) AS portfolio_count,
      to_char(firm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_on
    FROM public.firms AS firm
    LEFT JOIN public.subscriptions AS subscription
      ON subscription.firm_id = firm.id
  ) AS row;
$$;

CREATE OR REPLACE FUNCTION public.admin_firm_detail(target_firm uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT row_to_json(detail)
  FROM (
    SELECT
      firm.id::text AS id,
      firm.name,
      firm.holdings_classification_source,
      to_char(firm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_on,
      COALESCE(subscription.plan_code, 'free') AS plan_code,
      COALESCE(subscription.status, 'active') AS subscription_status,
      (firm.disabled_at IS NULL) AS enabled,
      plan.portfolio_limit,
      plan.ticker_limit,
      (
        SELECT COALESCE(sum(portfolio.portfolio_value), 0)::float8
        FROM public.portfolios AS portfolio
        WHERE portfolio.firm_id = firm.id
      ) AS total_aum,
      (
        SELECT count(*)::int
        FROM public.firm_members AS member
        WHERE member.firm_id = firm.id
      ) AS advisor_count,
      (
        SELECT count(*)::int
        FROM public.portfolios AS portfolio
        WHERE portfolio.firm_id = firm.id
      ) AS portfolio_count,
      (
        SELECT COALESCE(json_agg(advisor ORDER BY advisor.full_name, advisor.email), '[]'::json)
        FROM (
          SELECT
            account_user.id::text AS user_id,
            COALESCE(NULLIF(btrim(profile.full_name), ''), account_user.email) AS full_name,
            account_user.email,
            member.role,
            (profile.disabled_at IS NULL) AS enabled,
            false AS pending
          FROM public.firm_members AS member
          JOIN auth.users AS account_user ON account_user.id = member.user_id
          LEFT JOIN public.profiles AS profile ON profile.id = account_user.id
          WHERE member.firm_id = firm.id
            AND account_user.deleted_at IS NULL
        ) AS advisor
      ) AS advisors,
      (
        SELECT COALESCE(json_agg(invite ORDER BY invite.full_name, invite.email), '[]'::json)
        FROM (
          SELECT
            pending.id::text AS invite_id,
            pending.full_name,
            pending.email,
            pending.role,
            true AS pending,
            to_char(pending.invited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS invited_on,
            (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'portfolio_id', link.portfolio_id::text,
                    'name', portfolio.name,
                    'is_lead', link.is_lead
                  )
                  ORDER BY link.is_lead DESC, portfolio.name
                ),
                '[]'::json
              )
              FROM public.firm_advisor_invite_portfolios AS link
              JOIN public.portfolios AS portfolio ON portfolio.id = link.portfolio_id
              WHERE link.invite_id = pending.id
            ) AS portfolios
          FROM public.firm_advisor_invites AS pending
          WHERE pending.firm_id = firm.id
            AND pending.accepted_at IS NULL
        ) AS invite
      ) AS pending_advisors,
      (
        SELECT COALESCE(json_agg(portfolio_row ORDER BY portfolio_row.name), '[]'::json)
        FROM (
          SELECT
            portfolio.id::text AS id,
            portfolio.name,
            COALESCE(portfolio.portfolio_value, 0)::float8 AS portfolio_value,
            (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'user_id', assignment.user_id::text,
                    'full_name', COALESCE(NULLIF(btrim(assignee_profile.full_name), ''), assignee.email),
                    'is_lead', assignment.is_lead
                  )
                  ORDER BY assignment.is_lead DESC, assignee_profile.full_name, assignee.email
                ),
                '[]'::json
              )
              FROM public.portfolio_advisors AS assignment
              JOIN auth.users AS assignee ON assignee.id = assignment.user_id
              LEFT JOIN public.profiles AS assignee_profile ON assignee_profile.id = assignee.id
              WHERE assignment.portfolio_id = portfolio.id
            ) AS advisors
          FROM public.portfolios AS portfolio
          WHERE portfolio.firm_id = firm.id
        ) AS portfolio_row
      ) AS portfolios
    FROM public.firms AS firm
    LEFT JOIN public.subscriptions AS subscription ON subscription.firm_id = firm.id
    LEFT JOIN public.plans AS plan ON plan.code = COALESCE(subscription.plan_code, 'free')
    WHERE firm.id = target_firm
  ) AS detail;
$$;

ALTER FUNCTION public.admin_firms_list() OWNER TO postgres;
ALTER FUNCTION public.admin_firm_detail(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_firms_list() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_firm_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_firms_list() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.admin_firm_detail(uuid) TO postgres, service_role;

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

ALTER FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_firm_access(UUID, BOOLEAN) TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
