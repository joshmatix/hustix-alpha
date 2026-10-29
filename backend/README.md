# Backend API (FastAPI)

Hustix Macro API: portfolios, holdings CSV upload, live risk simulation, Stripe, reports, and admin helpers. The Next.js app on port **3000** calls this service on port **8000**.

## Quick start

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then fill in keys
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs for OpenAPI.

The admin console on port **3090** can start/stop this process; see [admin/README.md](../admin/README.md) for ports, Supabase, and firm load workflows.

**Firm tenancy:** Subscriptions, portfolio limits, and RLS-scoped data are tied to the **firm**, not to individual advisors. One login email maps to one firm; multi-firm advisors need separate email addresses. See [admin/README.md — Firm tenancy](../admin/README.md#firm-tenancy-product-policy).

## Environment

Copy [`.env.example`](.env.example) to `.env`. Common variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Local: `http://127.0.0.1:54321`; hosted: project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase client |
| `ADMIN_PASSWORD` | Same value as `admin/.env` and `/admin` on the site |
| `MARKET_DATA_PROVIDER` | `yahoo`, `eodhd`, or `tiingo` |
| `TIINGO_API_KEY` | Required when provider is `tiingo` |
| `EODHD_API_KEY` | Required when provider is `eodhd` |
| `FRED_API_KEY` | Header Fed Funds / 10Y (and Tiingo ^TNX-style series). Without it, those tickers show `—`; Bitcoin and USD still load from the market-data provider. Set this on the **Vercel backend** service, not only in local `backend/.env`. |
| `STRIPE_*` | Checkout and webhooks |
| `SMTP_*` / `RESEND_API_KEY` | Firm invite and contact mail ([`mailer.py`](mailer.py)) |

**Holdings CSV asset class:** firms default to CSV (`asset_class` in the file). Owners can set **Tiingo (authoritative)** under Profile → Holdings import; that mode needs `MARKET_DATA_PROVIDER=tiingo` and a valid `TIINGO_API_KEY`.

## Database migrations

SQL lives in [`../supabase/migrations/`](../supabase/migrations/). This repo applies them manually (not only via `supabase db push`). For local Postgres:

```bash
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/<file>.sql
```

See [admin/README.md](../admin/README.md) for the usual catch-up list after pulling new migrations. On a **new hosted Supabase** project, run the full ordered set described in team docs or ask for the greenfield checklist.

## Tests

From `backend/`:

```bash
PYTHONPATH=. .venv/bin/pytest
```

## Notes

_Add your own runbook items below (deploy steps, cloud env, one-off commands)._

-
