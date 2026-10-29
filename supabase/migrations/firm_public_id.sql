-- Stable public identifier for firms (append load-firm by firm_id).

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS public_id TEXT;

CREATE OR REPLACE FUNCTION public.generate_firm_public_id()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  candidate TEXT;
  attempt INT := 0;
  idx INT;
BEGIN
  LOOP
    candidate := 'firm_';
    FOR idx IN 1..11 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.firms AS existing WHERE existing.public_id = candidate
    );
    attempt := attempt + 1;
    IF attempt > 200 THEN
      RAISE EXCEPTION 'Could not generate firm public_id';
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

UPDATE public.firms AS firm
SET public_id = public.generate_firm_public_id()
WHERE firm.public_id IS NULL;

ALTER TABLE public.firms
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS firms_public_id_key ON public.firms (public_id);

CREATE OR REPLACE FUNCTION public.firms_assign_public_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.public_id IS NULL OR btrim(NEW.public_id) = '' THEN
    NEW.public_id := public.generate_firm_public_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firms_public_id_before_insert ON public.firms;
CREATE TRIGGER firms_public_id_before_insert
  BEFORE INSERT ON public.firms
  FOR EACH ROW
  EXECUTE FUNCTION public.firms_assign_public_id();

ALTER FUNCTION public.generate_firm_public_id() OWNER TO postgres;
ALTER FUNCTION public.firms_assign_public_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.generate_firm_public_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_firm_public_id() TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
