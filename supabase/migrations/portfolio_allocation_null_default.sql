-- Portfolios have no asset mix until holdings are uploaded or JSON sets asset_allocation.

ALTER TABLE public.portfolios
  ALTER COLUMN asset_allocation DROP DEFAULT;

ALTER TABLE public.portfolios
  ALTER COLUMN asset_allocation SET DEFAULT NULL;

UPDATE public.portfolios AS p
SET asset_allocation = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.portfolio_holdings AS h WHERE h.portfolio_id = p.id
)
AND p.asset_allocation = '{"equities":60,"bonds":25,"realAssets":10,"cash":5}'::jsonb;

CREATE OR REPLACE FUNCTION public.admin_load_firm(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  firm_label TEXT;
  chosen_plan TEXT;
  firm_slug TEXT;
  new_firm UUID;
  owner_id UUID;
  advisor_row jsonb;
  portfolio_row jsonb;
  advisor_email TEXT;
  advisor_name TEXT;
  advisor_user UUID;
  advisor_role TEXT;
  new_invite UUID;
  new_portfolio UUID;
  portfolio_name TEXT;
  account_code TEXT;
  sub_code TEXT;
  portfolio_value NUMERIC;
  import_key TEXT;
  assign_email TEXT;
  lead_email TEXT;
  assigned BOOLEAN;
  is_lead_row BOOLEAN;
  first_for_portfolio BOOLEAN;
  advisor_count INT := 0;
  invited_count INT := 0;
  portfolio_map jsonb := '{}'::jsonb;
  lead_map jsonb := '{}'::jsonb;
  email_to_user jsonb := '{}'::jsonb;
  email_to_invite jsonb := '{}'::jsonb;
  lead_ids jsonb;
  pid_elem jsonb;
  pid_text TEXT;
  invited_emails jsonb := '[]'::jsonb;
BEGIN
  firm_label := btrim(COALESCE(NULLIF(payload->>'firm_name', ''), payload->>'firm', ''));
  IF firm_label = '' THEN
    RAISE EXCEPTION 'Firm name is required';
  END IF;

  firm_slug := upper(regexp_replace(firm_label, '[^A-Za-z0-9]+', '', 'g'));
  IF firm_slug = '' THEN
    firm_slug := 'FIRM';
  END IF;
  firm_slug := left(firm_slug, 24);

  chosen_plan := lower(btrim(COALESCE(payload->>'plan_code', 'pro_plus')));
  IF chosen_plan NOT IN ('free', 'pro', 'pro_plus', 'enterprise') THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  IF jsonb_typeof(payload->'advisors') IS DISTINCT FROM 'array'
     OR jsonb_array_length(payload->'advisors') = 0 THEN
    RAISE EXCEPTION 'Add at least one advisor';
  END IF;

  INSERT INTO public.firms (name)
  VALUES (firm_label)
  RETURNING id INTO new_firm;

  PERFORM public.ensure_firm_subscription(new_firm, chosen_plan);

  owner_id := NULL;
  FOR advisor_row IN SELECT value FROM jsonb_array_elements(payload->'advisors') AS value
  LOOP
    advisor_email := lower(btrim(COALESCE(
      NULLIF(advisor_row->>'email', ''),
      advisor_row->>'advisor_email',
      ''
    )));
    IF advisor_email = '' OR advisor_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Each advisor needs a valid email';
    END IF;

    advisor_name := btrim(COALESCE(
      NULLIF(advisor_row->>'full_name', ''),
      advisor_row->>'advisor_name',
      ''
    ));

    advisor_role := lower(btrim(COALESCE(advisor_row->>'role', 'advisor')));
    IF advisor_role NOT IN ('owner', 'advisor') THEN
      advisor_role := 'advisor';
    END IF;

    SELECT account_user.id
    INTO advisor_user
    FROM auth.users AS account_user
    WHERE lower(account_user.email) = advisor_email
      AND account_user.deleted_at IS NULL
    LIMIT 1;

    IF advisor_user IS NOT NULL THEN
      IF advisor_role = 'owner' AND owner_id IS NULL THEN
        owner_id := advisor_user;
      END IF;

      UPDATE public.profiles
      SET
        full_name = COALESCE(NULLIF(advisor_name, ''), full_name),
        firm_name = firm_label
      WHERE id = advisor_user;

      INSERT INTO public.firm_members (firm_id, user_id, role)
      VALUES (new_firm, advisor_user, advisor_role)
      ON CONFLICT (firm_id, user_id) DO UPDATE
      SET role = EXCLUDED.role;

      email_to_user := jsonb_set(email_to_user, ARRAY[advisor_email], to_jsonb(advisor_user::text), true);
    ELSE
      IF email_to_invite ? advisor_email THEN
        new_invite := (email_to_invite->>advisor_email)::uuid;
        UPDATE public.firm_advisor_invites
        SET
          full_name = COALESCE(NULLIF(advisor_name, ''), full_name),
          role = CASE WHEN advisor_role = 'owner' THEN 'owner' ELSE role END
        WHERE id = new_invite;
      ELSE
        INSERT INTO public.firm_advisor_invites (firm_id, email, full_name, role)
        VALUES (new_firm, advisor_email, advisor_name, advisor_role)
        RETURNING id INTO new_invite;

        email_to_invite := jsonb_set(email_to_invite, ARRAY[advisor_email], to_jsonb(new_invite::text), true);
        invited_emails := invited_emails || to_jsonb(advisor_email);
        invited_count := invited_count + 1;
      END IF;
    END IF;

    IF jsonb_typeof(advisor_row->'portfolio_ids') = 'array' THEN
      FOR pid_elem IN SELECT value FROM jsonb_array_elements(advisor_row->'portfolio_ids') AS value
      LOOP
        pid_text := btrim(pid_elem #>> '{}');
        IF pid_text = '' THEN
          CONTINUE;
        END IF;
        portfolio_map := jsonb_set(
          portfolio_map,
          ARRAY[pid_text],
          COALESCE(portfolio_map->pid_text, '[]'::jsonb) || to_jsonb(advisor_email),
          true
        );
      END LOOP;
    END IF;

    lead_ids := advisor_row->'lead_portfolio_ids';
    IF jsonb_typeof(lead_ids) = 'array' THEN
      FOR pid_elem IN SELECT value FROM jsonb_array_elements(lead_ids) AS value
      LOOP
        pid_text := btrim(pid_elem #>> '{}');
        IF pid_text = '' THEN
          CONTINUE;
        END IF;
        lead_map := jsonb_set(lead_map, ARRAY[pid_text], to_jsonb(advisor_email), true);
      END LOOP;
    END IF;

    advisor_count := advisor_count + 1;
  END LOOP;

  IF owner_id IS NULL THEN
    SELECT member.user_id
    INTO owner_id
    FROM public.firm_members AS member
    WHERE member.firm_id = new_firm
    ORDER BY (member.role = 'owner') DESC, member.created_at
    LIMIT 1;
  END IF;

  IF owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.firm_members WHERE firm_id = new_firm AND role = 'owner'
  ) THEN
    UPDATE public.firm_members
    SET role = 'owner'
    WHERE firm_id = new_firm
      AND user_id = owner_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.firm_members WHERE firm_id = new_firm AND role = 'owner'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.firm_advisor_invites
    WHERE firm_id = new_firm AND role = 'owner' AND accepted_at IS NULL
  ) THEN
    UPDATE public.firm_advisor_invites
    SET role = 'owner'
    WHERE id = (
      SELECT invite.id
      FROM public.firm_advisor_invites AS invite
      WHERE invite.firm_id = new_firm
        AND invite.accepted_at IS NULL
      ORDER BY invite.invited_at
      LIMIT 1
    );
  END IF;

  IF jsonb_typeof(payload->'portfolios') = 'array' THEN
    FOR portfolio_row IN SELECT value FROM jsonb_array_elements(payload->'portfolios') AS value
    LOOP
      portfolio_name := btrim(COALESCE(
        NULLIF(portfolio_row->>'name', ''),
        portfolio_row->>'portfolio_name',
        ''
      ));
      IF portfolio_name = '' THEN
        RAISE EXCEPTION 'Each portfolio needs a name';
      END IF;

      import_key := btrim(COALESCE(
        NULLIF(portfolio_row->>'portfolio_id', ''),
        portfolio_row->>'import_id',
        ''
      ));
      IF import_key = '' AND jsonb_typeof(portfolio_row->'portfolio_id') = 'number' THEN
        import_key := portfolio_row->>'portfolio_id';
      END IF;

      account_code := btrim(COALESCE(portfolio_row->>'account_number', ''));
      sub_code := btrim(COALESCE(portfolio_row->>'sub_account_number', ''));
      IF account_code = '' THEN
        account_code := firm_slug;
      END IF;
      IF sub_code = '' THEN
        sub_code := COALESCE(NULLIF(import_key, ''), lpad((
          SELECT count(*)::text
          FROM public.portfolios AS existing
          WHERE existing.firm_id = new_firm
        ), 3, '0'));
      END IF;

      portfolio_value := COALESCE((portfolio_row->>'portfolio_value')::numeric, 0);

      INSERT INTO public.portfolios (
        firm_id,
        created_by,
        name,
        description,
        account_number,
        sub_account_number,
        account_alias,
        target_risk_profile,
        portfolio_value,
        asset_allocation
      )
      VALUES (
        new_firm,
        owner_id,
        portfolio_name,
        COALESCE(portfolio_row->>'description', ''),
        account_code,
        sub_code,
        portfolio_name,
        COALESCE(portfolio_row->>'target_risk_profile', 'Balanced'),
        portfolio_value,
        portfolio_row->'asset_allocation'
      )
      RETURNING id INTO new_portfolio;

      assigned := false;
      first_for_portfolio := true;
      lead_email := NULLIF(btrim(COALESCE(lead_map->>import_key, '')), '');

      IF jsonb_typeof(portfolio_row->'advisor_emails') = 'array'
         AND jsonb_array_length(portfolio_row->'advisor_emails') > 0 THEN
        FOR assign_email IN
          SELECT lower(btrim(elem))
          FROM jsonb_array_elements_text(portfolio_row->'advisor_emails') AS elem
        LOOP
          IF assign_email = '' THEN
            CONTINUE;
          END IF;
          is_lead_row := (lead_email IS NOT NULL AND assign_email = lead_email)
            OR (lead_email IS NULL AND first_for_portfolio);

          IF email_to_user ? assign_email THEN
            advisor_user := (email_to_user->>assign_email)::uuid;
            IF is_lead_row THEN
              UPDATE public.portfolio_advisors AS assignment
              SET is_lead = false
              WHERE assignment.portfolio_id = new_portfolio;
            END IF;
            INSERT INTO public.portfolio_advisors (portfolio_id, user_id, is_lead)
            VALUES (new_portfolio, advisor_user, is_lead_row)
            ON CONFLICT (portfolio_id, user_id) DO UPDATE
            SET is_lead = EXCLUDED.is_lead;
          ELSIF email_to_invite ? assign_email THEN
            new_invite := (email_to_invite->>assign_email)::uuid;
            IF is_lead_row THEN
              UPDATE public.firm_advisor_invite_portfolios
              SET is_lead = false
              WHERE portfolio_id = new_portfolio;
            END IF;
            INSERT INTO public.firm_advisor_invite_portfolios (invite_id, portfolio_id, is_lead)
            VALUES (new_invite, new_portfolio, is_lead_row)
            ON CONFLICT (invite_id, portfolio_id) DO UPDATE
            SET is_lead = EXCLUDED.is_lead;
          ELSE
            RAISE EXCEPTION 'Advisor % is not on this firm', assign_email;
          END IF;

          assigned := true;
          first_for_portfolio := false;
        END LOOP;
      ELSIF import_key <> '' AND jsonb_typeof(portfolio_map->import_key) = 'array' THEN
        FOR assign_email IN
          SELECT lower(btrim(elem))
          FROM jsonb_array_elements_text(portfolio_map->import_key) AS elem
        LOOP
          IF assign_email = '' THEN
            CONTINUE;
          END IF;
          is_lead_row := (lead_email IS NOT NULL AND assign_email = lead_email)
            OR (lead_email IS NULL AND first_for_portfolio);

          IF email_to_user ? assign_email THEN
            advisor_user := (email_to_user->>assign_email)::uuid;
            IF is_lead_row THEN
              UPDATE public.portfolio_advisors AS assignment
              SET is_lead = false
              WHERE assignment.portfolio_id = new_portfolio;
            END IF;
            INSERT INTO public.portfolio_advisors (portfolio_id, user_id, is_lead)
            VALUES (new_portfolio, advisor_user, is_lead_row)
            ON CONFLICT (portfolio_id, user_id) DO UPDATE
            SET is_lead = EXCLUDED.is_lead;
          ELSIF email_to_invite ? assign_email THEN
            new_invite := (email_to_invite->>assign_email)::uuid;
            IF is_lead_row THEN
              UPDATE public.firm_advisor_invite_portfolios
              SET is_lead = false
              WHERE portfolio_id = new_portfolio;
            END IF;
            INSERT INTO public.firm_advisor_invite_portfolios (invite_id, portfolio_id, is_lead)
            VALUES (new_invite, new_portfolio, is_lead_row)
            ON CONFLICT (invite_id, portfolio_id) DO UPDATE
            SET is_lead = EXCLUDED.is_lead;
          ELSE
            RAISE EXCEPTION 'Advisor % is not on this firm', assign_email;
          END IF;

          assigned := true;
          first_for_portfolio := false;
        END LOOP;
      END IF;

      IF NOT assigned AND owner_id IS NOT NULL THEN
        INSERT INTO public.portfolio_advisors (portfolio_id, user_id, is_lead)
        VALUES (new_portfolio, owner_id, true)
        ON CONFLICT (portfolio_id, user_id) DO UPDATE
        SET is_lead = true;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.portfolio_advisors WHERE portfolio_id = new_portfolio
      ) THEN
        PERFORM public.sync_portfolio_lead(new_portfolio);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'firm_id', new_firm::text,
    'advisor_count', advisor_count,
    'invited_count', invited_count,
    'invited_emails', invited_emails
  );
END;
$$;

ALTER FUNCTION public.admin_load_firm(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_load_firm(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_load_firm(jsonb) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
