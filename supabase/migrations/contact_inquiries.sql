-- Questions sent from the public homepage contact form.
-- Only the service role can read or write this table.

CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.contact_inquiries TO service_role;

NOTIFY pgrst, 'reload schema';
