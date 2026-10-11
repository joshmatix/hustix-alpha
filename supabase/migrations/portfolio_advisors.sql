-- A portfolio belongs to one firm. Advisors see a portfolio only when they
-- are assigned to it. One portfolio can have many advisors, and one advisor
-- can be assigned to many portfolios. The advisor must already belong to
-- that portfolio's firm.

CREATE TABLE IF NOT EXISTS public.portfolio_advisors (
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (portfolio_id, user_id)
);

CREATE INDEX IF NOT EXISTS portfolio_advisors_user_id_idx
  ON public.portfolio_advisors (user_id);

ALTER TABLE public.portfolio_advisors ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_portfolio_advisor_firm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolios p
    JOIN public.firm_members m
      ON m.firm_id = p.firm_id
     AND m.user_id = NEW.user_id
    WHERE p.id = NEW.portfolio_id
  ) THEN
    RAISE EXCEPTION 'Advisor must belong to the portfolio firm';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_portfolio_advisor_firm() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_portfolio_advisor_firm() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portfolio_advisors_require_firm_member ON public.portfolio_advisors;
CREATE TRIGGER portfolio_advisors_require_firm_member
  BEFORE INSERT OR UPDATE ON public.portfolio_advisors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_portfolio_advisor_firm();

INSERT INTO public.portfolio_advisors (portfolio_id, user_id)
SELECT p.id, p.created_by
FROM public.portfolios p
JOIN public.firm_members m
  ON m.firm_id = p.firm_id
 AND m.user_id = p.created_by
WHERE p.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.portfolios p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.portfolio_advisors a WHERE a.portfolio_id = p.id
    )
  ) THEN
    RAISE EXCEPTION 'portfolios remain without an assigned advisor';
  END IF;
END $$;

-- Insert asks PostgREST to return the new row before the creator is assigned.
-- The creator may read that row only while it has no assignees. Once anyone
-- is assigned, only those advisors can read it.
CREATE OR REPLACE FUNCTION public.portfolio_has_assignee(portfolio UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.portfolio_advisors a WHERE a.portfolio_id = portfolio
  );
END;
$$;

ALTER FUNCTION public.portfolio_has_assignee(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portfolio_has_assignee(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portfolio_has_assignee(UUID) TO authenticated, service_role, postgres;

DROP POLICY IF EXISTS "Advisors can manage firm portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can read assigned portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can create firm portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can update assigned portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can delete assigned portfolios" ON public.portfolios;

CREATE POLICY "Advisors can read assigned portfolios"
  ON public.portfolios FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolio_advisors a
      WHERE a.portfolio_id = id AND a.user_id = auth.uid()
    )
    OR (
      created_by = auth.uid()
      AND NOT public.portfolio_has_assignee(id)
    )
  );

CREATE POLICY "Advisors can create firm portfolios"
  ON public.portfolios FOR INSERT
  TO authenticated
  WITH CHECK (firm_id IN (SELECT public.current_firm_ids()));

CREATE POLICY "Advisors can update assigned portfolios"
  ON public.portfolios FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolio_advisors a
      WHERE a.portfolio_id = id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (firm_id IN (SELECT public.current_firm_ids()));

CREATE POLICY "Advisors can delete assigned portfolios"
  ON public.portfolios FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolio_advisors a
      WHERE a.portfolio_id = id AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Advisors can manage firm holdings" ON public.portfolio_holdings;
DROP POLICY IF EXISTS "Advisors can manage assigned holdings" ON public.portfolio_holdings;
CREATE POLICY "Advisors can manage assigned holdings"
  ON public.portfolio_holdings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolio_advisors a
      WHERE a.portfolio_id = portfolio_holdings.portfolio_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.portfolio_advisors a
      WHERE a.portfolio_id = portfolio_holdings.portfolio_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Advisors can view own portfolio assignments" ON public.portfolio_advisors;
DROP POLICY IF EXISTS "Advisors can assign themselves" ON public.portfolio_advisors;

CREATE POLICY "Advisors can view own portfolio assignments"
  ON public.portfolio_advisors FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Advisors can assign themselves"
  ON public.portfolio_advisors FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND p.firm_id IN (SELECT public.current_firm_ids())
    )
  );

REVOKE ALL ON public.portfolio_advisors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.portfolio_advisors TO authenticated;
GRANT ALL ON public.portfolio_advisors TO service_role;
