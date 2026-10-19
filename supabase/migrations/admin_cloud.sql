-- Cloud admin screen. Lists advisors with an open auth session.
-- Run this once on the hosted database. service_role is the only caller.

CREATE OR REPLACE FUNCTION public.admin_open_accounts()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(json_agg(row ORDER BY row.last_seen DESC), '[]'::json)
  FROM (
    SELECT
      account_user.email,
      COALESCE(profile.full_name, '') AS full_name,
      COALESCE(account.firm_name, '') AS firm_name,
      COALESCE(account.role, '') AS role,
      COALESCE(account.plan_code, profile.plan, 'free') AS plan_code,
      to_char(open_session.last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
    FROM (
      SELECT
        session.user_id,
        max(GREATEST(
          COALESCE(session.updated_at, session.created_at),
          COALESCE(session.refreshed_at AT TIME ZONE 'UTC', session.created_at)
        )) AS last_seen
      FROM auth.sessions AS session
      WHERE (session.not_after IS NULL OR session.not_after > timezone('utc', now()))
        AND GREATEST(
          COALESCE(session.updated_at, session.created_at),
          COALESCE(session.refreshed_at AT TIME ZONE 'UTC', session.created_at)
        ) > timezone('utc', now()) - interval '8 hours'
        AND EXISTS (
          SELECT 1
          FROM auth.refresh_tokens AS token
          WHERE token.session_id = session.id
            AND token.revoked IS NOT TRUE
        )
      GROUP BY session.user_id
    ) AS open_session
    JOIN auth.users AS account_user ON account_user.id = open_session.user_id
    LEFT JOIN public.profiles AS profile ON profile.id = account_user.id
    LEFT JOIN LATERAL (
      SELECT
        string_agg(firm.name, ', ' ORDER BY (member.role = 'owner') DESC, firm.name) AS firm_name,
        (array_agg(member.role ORDER BY (member.role = 'owner') DESC, member.created_at))[1] AS role,
        (array_agg(subscription.plan_code ORDER BY (member.role = 'owner') DESC, member.created_at))[1] AS plan_code
      FROM public.firm_members AS member
      JOIN public.firms AS firm ON firm.id = member.firm_id
      LEFT JOIN public.subscriptions AS subscription ON subscription.firm_id = firm.id
      WHERE member.user_id = account_user.id
    ) AS account ON true
    WHERE account_user.deleted_at IS NULL
  ) AS row;
$$;

ALTER FUNCTION public.admin_open_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_open_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_open_accounts() TO service_role;
