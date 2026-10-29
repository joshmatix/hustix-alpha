-- Pending firm advisors invited before they have an auth account.
-- On signup, claim_firm_invites attaches membership and portfolio assignments.

CREATE TABLE IF NOT EXISTS public.firm_advisor_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'advisor' CHECK (role IN ('owner', 'advisor')),
  invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  accepted_at TIMESTAMP WITH TIME ZONE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT firm_advisor_invites_email_format
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS firm_advisor_invites_pending_email_firm_idx
  ON public.firm_advisor_invites (firm_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS firm_advisor_invites_email_idx
  ON public.firm_advisor_invites (lower(email))
  WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.firm_advisor_invite_portfolios (
  invite_id UUID NOT NULL REFERENCES public.firm_advisor_invites(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (invite_id, portfolio_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS firm_advisor_invite_portfolios_one_lead_idx
  ON public.firm_advisor_invite_portfolios (portfolio_id)
  WHERE is_lead;

ALTER TABLE public.firm_advisor_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_advisor_invite_portfolios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.firm_advisor_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.firm_advisor_invite_portfolios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.firm_advisor_invites TO postgres, service_role;
GRANT ALL ON public.firm_advisor_invite_portfolios TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.claim_firm_invites(new_user UUID, user_email TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invite_row RECORD;
  assign_row RECORD;
  claimed INT := 0;
  firm_label TEXT;
  has_lead BOOLEAN;
BEGIN
  IF new_user IS NULL OR COALESCE(btrim(user_email), '') = '' THEN
    RETURN 0;
  END IF;

  FOR invite_row IN
    SELECT invite.*
    FROM public.firm_advisor_invites AS invite
    WHERE invite.accepted_at IS NULL
      AND lower(invite.email) = lower(btrim(user_email))
    ORDER BY invite.invited_at
  LOOP
    SELECT firm.name INTO firm_label
    FROM public.firms AS firm
    WHERE firm.id = invite_row.firm_id;

    UPDATE public.profiles
    SET
      full_name = COALESCE(NULLIF(btrim(invite_row.full_name), ''), full_name),
      firm_name = COALESCE(firm_label, firm_name)
    WHERE id = new_user;

    INSERT INTO public.firm_members (firm_id, user_id, role)
    VALUES (invite_row.firm_id, new_user, invite_row.role)
    ON CONFLICT (firm_id, user_id) DO UPDATE
    SET role = CASE
      WHEN EXCLUDED.role = 'owner' THEN 'owner'
      ELSE public.firm_members.role
    END;

    FOR assign_row IN
      SELECT link.portfolio_id, link.is_lead
      FROM public.firm_advisor_invite_portfolios AS link
      WHERE link.invite_id = invite_row.id
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM public.portfolio_advisors AS assignment
        WHERE assignment.portfolio_id = assign_row.portfolio_id
          AND assignment.is_lead
      ) INTO has_lead;

      INSERT INTO public.portfolio_advisors (portfolio_id, user_id, is_lead)
      VALUES (
        assign_row.portfolio_id,
        new_user,
        assign_row.is_lead OR NOT has_lead
      )
      ON CONFLICT (portfolio_id, user_id) DO UPDATE
      SET is_lead = CASE
        WHEN assign_row.is_lead THEN true
        ELSE public.portfolio_advisors.is_lead
      END;

      IF assign_row.is_lead THEN
        UPDATE public.portfolio_advisors
        SET is_lead = (user_id = new_user)
        WHERE portfolio_id = assign_row.portfolio_id;
      END IF;

      PERFORM public.sync_portfolio_lead(assign_row.portfolio_id);
    END LOOP;

    UPDATE public.firm_advisor_invites
    SET
      accepted_at = timezone('utc'::text, now()),
      user_id = new_user
    WHERE id = invite_row.id;

    claimed := claimed + 1;
  END LOOP;

  RETURN claimed;
END;
$$;

ALTER FUNCTION public.claim_firm_invites(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_firm_invites(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_firm_invites(UUID, TEXT) TO postgres, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen_plan TEXT;
  claimed INT;
BEGIN
  chosen_plan := lower(COALESCE(NEW.raw_user_meta_data->>'plan', 'free'));
  IF chosen_plan <> 'pro' THEN
    chosen_plan := 'free';
  END IF;

  INSERT INTO public.profiles (id, full_name, plan)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    chosen_plan
  )
  ON CONFLICT (id) DO NOTHING;

  claimed := public.claim_firm_invites(NEW.id, NEW.email);

  IF claimed = 0 THEN
    PERFORM public.attach_shadow_firm(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

-- Allow portfolios with only pending invite assignees (no live portfolio_advisors yet).
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
  invite_id UUID;
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

  SELECT firm.name INTO firm_label FROM public.firms AS firm WHERE firm.id = target_firm;

  IF advisor_user IS NOT NULL THEN
    UPDATE public.profiles
    SET
      full_name = COALESCE(NULLIF(btrim(advisor_name), ''), full_name),
      firm_name = firm_label
    WHERE id = advisor_user;

    INSERT INTO public.firm_members (firm_id, user_id, role)
    VALUES (target_firm, advisor_user, role_norm)
    ON CONFLICT (firm_id, user_id) DO UPDATE
    SET role = EXCLUDED.role;

    RETURN jsonb_build_object(
      'user_id', advisor_user::text,
      'firm_id', target_firm::text,
      'pending', false,
      'email', email_norm
    );
  END IF;

  SELECT invite.id
  INTO invite_id
  FROM public.firm_advisor_invites AS invite
  WHERE invite.firm_id = target_firm
    AND lower(invite.email) = email_norm
    AND invite.accepted_at IS NULL
  LIMIT 1;

  IF invite_id IS NULL THEN
    INSERT INTO public.firm_advisor_invites (firm_id, email, full_name, role)
    VALUES (target_firm, email_norm, COALESCE(NULLIF(btrim(advisor_name), ''), ''), role_norm)
    RETURNING id INTO invite_id;
  ELSE
    UPDATE public.firm_advisor_invites
    SET
      full_name = COALESCE(NULLIF(btrim(advisor_name), ''), full_name),
      role = role_norm,
      invited_at = timezone('utc'::text, now())
    WHERE id = invite_id;
  END IF;

  RETURN jsonb_build_object(
    'invite_id', invite_id::text,
    'firm_id', target_firm::text,
    'pending', true,
    'email', email_norm
  );
END;
$$;

ALTER FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_firm_advisor(UUID, TEXT, TEXT, TEXT) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
