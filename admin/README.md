# Admin

## Start the admin console

From the `hustix-alpha` directory:

```bash
python3 admin/server.py
```

Open http://127.0.0.1:3090

The password is `ADMIN_PASSWORD` in `admin/.env`. The first start writes that file when it is missing. The site admin at http://127.0.0.1:3000/admin uses the same value. On the hosted API, set `ADMIN_PASSWORD` in the service environment.

The console listens on port **3090**. It stays up when the site and the API are stopped, so those processes can be started from its Services section (local Docker Postgres only).

## Cloud database from your laptop (:3090)

To run the full firm console (portfolio map, delete firm, raw SQL parity) against **hosted Supabase Postgres** without exposing port 3090 on the public site:

1. In Supabase Dashboard → **Database** → **Connection string**, copy the URI (pooler port **6543** or direct **5432**). Use the database password from project settings.
2. Add to `admin/.env` (gitignored), not committed:

   ```bash
   ADMIN_DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```

3. Start the console as usual: `python3 admin/server.py`. The UI shows **Connected to hosted database** and hides **Services** (start/stop only applies to local dev).
4. Align the app when testing end-to-end against that data: `backend/.env` must use the **same** hosted `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and anon key—not `127.0.0.1:54321`.

**Security**

- Treat `ADMIN_DATABASE_URL` like root DB access. Never commit it or put it on Vercel.
- Prefer the pooler with SSL (`PGSSLMODE=require` is the default when using the URL mode).
- Use Supabase **network restrictions** / IP allowlisting on the project when available.
- Use the same `ADMIN_PASSWORD` as production admin; anyone with the password and the URL can change all data.

Apply hosted migrations with the same URL when needed:

```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/admin_firm_read.sql
```

Or paste migration files in the Supabase SQL Editor in your usual order.

## Ports

| Service | Port | Address |
| --- | --- | --- |
| Admin console | 3090 | http://127.0.0.1:3090 |
| Frontend, including `/admin` | 3000 | http://127.0.0.1:3000 |
| Backend API | 8000 | http://127.0.0.1:8000 |
| Local Supabase API | 54321 | http://127.0.0.1:54321 |
| Local Postgres | 54322 | container `supabase_db_my-macro-app` |

## Two admin screens

Port 3090 starts and stops the frontend and the backend, lists firms on the main screen, opens a **Firm console** overlay for the three-column view (firm list, firm details, advisor/portfolio map), loads new firms from JSON (or CSV), enables or disables firms and advisors, assigns advisors to portfolios (one lead per portfolio), and edits plan caps.

Disabling a firm disables all of its advisors; re-enabling a firm does not re-enable advisors. Logs are `admin/logs/frontend.log` and `admin/logs/backend.log`.

http://127.0.0.1:3000/admin manages advisors and **hosted firm tasks** (list, detail, load JSON, enable/disable, holdings classification source). Portfolio assign, delete firm, and the three-column firm console stay on local **:3090** with `ADMIN_DATABASE_URL` for cloud data. The frontend must be on port 3000 and the API on port 8000. That screen does not start those processes.

### Load firm JSON (preferred)

On **Load firm**, use **Choose JSON…**. Example: `admin/examples/wealth-advisors-group.load-firm.json`.

```json
{
  "firm": "Wealth Advisors Group",
  "plan_code": "pro_plus",
  "portfolios": [
    { "portfolio_id": 1, "portfolio_name": "Lazy Portfolio" }
  ],
  "advisors": [
    {
      "advisor_name": "Alaina Brooks",
      "advisor_email": "alaina@example.com",
      "portfolio_ids": [1, 2, 3]
    }
  ]
}
```

Rules:
- `advisor_email` is required. If the address is not in auth yet, a **pending invite** is stored and a **firm invite** email is sent via app SMTP (`backend/.env` → Resend when configured).
- After signup with that email, `claim_firm_invites` attaches firm membership and portfolio assignments automatically (no solo shadow firm).

### Two different emails (invite vs confirm)

| Message | Who sends it | Where it shows up locally | Purpose |
| --- | --- | --- | --- |
| **You're invited to … on Hustix Macro** | Admin console → [`backend/mailer.py`](../backend/mailer.py) (Resend SMTP) | Resend dashboard | Link to `/signup?email=…` |
| **Confirm your email for Hustix Macro** | Supabase Auth | [Mailpit](http://127.0.0.1:54324) (not Resend) | Required before password login for self-serve signups |

**Invited advisors** (pending row in `firm_advisor_invites`): after migration `invite_signup_auto_confirm.sql`, signup with that email is **auto-confirmed**—no second mail step.

**Self-serve signup** (no invite): the user must open the Supabase confirmation link before login works.

**If login says “Email not confirmed”**

- **Local:** open http://127.0.0.1:54324 → newest **Confirm your email** message → confirm link → `/auth/callback`.
- **Hosted:** Supabase Dashboard → **Authentication → Users** → confirm user, or configure **Project Settings → Authentication → SMTP** (Resend) so confirmation mail reaches Gmail. App contact/invite SMTP on Vercel does not replace Auth SMTP.

Apply the auto-confirm migration:

```bash
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/invite_signup_auto_confirm.sql
```
- First advisor becomes firm owner unless someone has `"role": "owner"`.
- Portfolio shells only: account numbers are auto-generated. **No default asset mix**—`asset_allocation` stays null until holdings CSV upload or you set `asset_allocation` in JSON. Upload holdings on the site when ready.
- First advisor listed for a portfolio is the lead unless `"lead_portfolio_ids"` is set on an advisor.

### Load firm CSV (legacy)

| record_type | Use these columns |
| --- | --- |
| `firm` | `firm_name`, `plan_code` (optional, default `pro_plus`) |
| `portfolio` | `portfolio_id`, `name`, `client_master_id`, `sub_account`, `portfolio_value` (optional) |
| `advisor` | `full_name`, `email`, `role` (`owner` or `advisor`), `portfolio_ids` (e.g. `1,2,3`) |

### Firm console ops

| Action | Where |
| --- | --- |
| Enable / disable firm | Firm detail pane |
| Delete firm | Firm detail pane → **Delete firm** (type firm name to confirm) |
| Add advisor | By advisors → **Add advisor** |
| Enable / disable advisor | By advisors |
| Assign advisor to portfolio | By portfolios → **Assign** |
| Set lead advisor | By portfolios → **Set lead** |
| Remove advisor from portfolio | By portfolios → **Remove** |

Apply local DB migrations when needed:

```bash
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/portfolio_advisor_lead.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/firm_advisor_invites.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/admin_load_firm_invites.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/admin_delete_firm.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/invite_signup_auto_confirm.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/invite_signup_auto_confirm_after.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/portfolio_allocation_null_default.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/holdings_classification_source.sql
docker exec -i supabase_db_my-macro-app psql -U postgres -d postgres < supabase/migrations/admin_firm_read.sql
```

**Holdings CSV asset class:** firms default to **CSV** (asset_class from the file). In the firm console or Profile → Holdings import, set **Tiingo (authoritative)** so uploads classify ETFs via Tiingo (`MARKET_DATA_PROVIDER=tiingo` on the API).

## Start the site without the console

Frontend:

```bash
cd frontend
npm run dev -- --port 3000 --hostname 0.0.0.0
```

Backend, after `backend/.venv` exists:

```bash
cd backend
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
