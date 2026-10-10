-- Canonical schema for MacroRisk Studio (profiles, portfolios, holdings)

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  firm_name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.portfolios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  account_alias TEXT,
  target_risk_profile TEXT DEFAULT 'Balanced',
  portfolio_value NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  asset_allocation JSONB DEFAULT '{"equities": 60, "bonds": 25, "realAssets": 10, "cash": 5}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Compatibility with older local databases that used client_name / no name column
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS account_alias TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS target_risk_profile TEXT DEFAULT 'Balanced';
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS portfolio_value NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS asset_allocation JSONB DEFAULT '{"equities": 60, "bonds": 25, "realAssets": 10, "cash": 5}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios' AND column_name = 'client_name'
  ) THEN
    UPDATE public.portfolios
    SET name = COALESCE(NULLIF(name, ''), client_name, 'Untitled')
    WHERE name IS NULL OR name = '';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.portfolio_holdings (
  holding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  ticker TEXT NOT NULL,
  asset_name TEXT,
  asset_class TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  current_price DOUBLE PRECISION NOT NULL,
  duration_years DOUBLE PRECISION DEFAULT 0,
  beta DOUBLE PRECISION DEFAULT 1.0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Advisors can manage own client portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Advisors can manage own holdings" ON public.portfolio_holdings;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Advisors can manage own client portfolios"
  ON public.portfolios FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Advisors can manage own holdings"
  ON public.portfolio_holdings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
