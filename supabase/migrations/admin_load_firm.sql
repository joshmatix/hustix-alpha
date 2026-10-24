-- Operator console: create a firm, attach existing auth users as advisors,
-- create portfolios, and assign advisors (0..n portfolios per advisor).

CREATE OR REPLACE FUNCTION public.admin_load_firm(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  firm_label TEXT;
  chosen_plan TEXT;
  new_firm UUID;
  owner_id UUID;
  advisor_row jsonb;
  portfolio_row jsonb;
  advisor_email TEXT;
  advisor_user UUID;
  advisor_role TEXT;
  portfolio_id UUID;
  portfolio_name TEXT;
  account_code TEXT;
  sub_code TEXT;
  portfolio_value NUMERIC;
  assign_email TEXT;
  assigned BOOLEAN;
  advisor_count INT := 0;
BEGIN
  firm_label := btrim(COALESCE(payload->>'firm_name', ''));
  IF firm_label = '' THEN
    RAISE EXCEPTION 'Firm name is required';
  END IF;

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
    advisor_email := lower(btrim(COALESCE(advisor_row->>'email', '')));
    IF advisor_email = '' OR advisor_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Each advisor needs a valid email';
    END IF;

    SELECT account_user.id
    INTO advisor_user
    FROM auth.users AS account_user
    WHERE lower(account_user.email) = advisor_email
      AND account_user.deleted_at IS NULL
    LIMIT 1;

    IF advisor_user IS NULL THEN
      RAISE EXCEPTION 'No account for %. Sign up that user first, then load the firm.', advisor_email;
    END IF;

    advisor_role := lower(btrim(COALESCE(advisor_row->>'role', 'advisor')));
    IF advisor_role NOT IN ('owner', 'advisor') THEN
      advisor_role := 'advisor';
    END IF;

    IF advisor_role = 'owner' AND owner_id IS NULL THEN
      owner_id := advisor_user;
    END IF;

    UPDATE public.profiles
    SET
      full_name = COALESCE(NULLIF(btrim(advisor_row->>'full_name'), ''), full_name),
      firm_name = firm_label
    WHERE id = advisor_user;

    INSERT INTO public.firm_members (firm_id, user_id, role)
    VALUES (new_firm, advisor_user, advisor_role)
    ON CONFLICT (firm_id, user_id) DO UPDATE
    SET role = EXCLUDED.role;

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

  IF jsonb_typeof(payload->'portfolios') = 'array' THEN
    FOR portfolio_row IN SELECT value FROM jsonb_array_elements(payload->'portfolios') AS value
    LOOP
      portfolio_name := btrim(COALESCE(portfolio_row->>'name', ''));
      IF portfolio_name = '' THEN
        RAISE EXCEPTION 'Each portfolio needs a name';
      END IF;

      account_code := btrim(COALESCE(portfolio_row->>'account_number', ''));
      sub_code := btrim(COALESCE(portfolio_row->>'sub_account_number', ''));
      IF account_code = '' OR sub_code = '' THEN
        RAISE EXCEPTION 'Each portfolio needs Client Master ID and Sub-Account';
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
        COALESCE(
          portfolio_row->'asset_allocation',
          '{"equities":60,"bonds":25,"realAssets":10,"cash":5}'::jsonb
        )
      )
      RETURNING id INTO portfolio_id;

      assigned := false;
      IF jsonb_typeof(portfolio_row->'advisor_emails') = 'array' THEN
        FOR assign_email IN
          SELECT lower(btrim(elem))
          FROM jsonb_array_elements_text(portfolio_row->'advisor_emails') AS elem
        LOOP
          IF assign_email = '' THEN
            CONTINUE;
          END IF;

          SELECT account_user.id
          INTO advisor_user
          FROM auth.users AS account_user
          JOIN public.firm_members AS member
            ON member.user_id = account_user.id
           AND member.firm_id = new_firm
          WHERE lower(account_user.email) = assign_email
            AND account_user.deleted_at IS NULL
          LIMIT 1;

          IF advisor_user IS NULL THEN
            RAISE EXCEPTION 'Advisor % is not on this firm', assign_email;
          END IF;

          INSERT INTO public.portfolio_advisors (portfolio_id, user_id)
          VALUES (portfolio_id, advisor_user)
          ON CONFLICT DO NOTHING;
          assigned := true;
        END LOOP;
      END IF;

      IF NOT assigned THEN
        INSERT INTO public.portfolio_advisors (portfolio_id, user_id)
        VALUES (portfolio_id, owner_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'firm_id', new_firm::text,
    'advisor_count', advisor_count
  );
END;
$$;

ALTER FUNCTION public.admin_load_firm(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_load_firm(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_load_firm(jsonb) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
