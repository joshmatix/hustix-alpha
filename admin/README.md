# Admin

## Start the admin console

From the `hustix-alpha` directory:

```bash
python3 admin/server.py
```

Open http://127.0.0.1:3090

The password is `ADMIN_PASSWORD` in `admin/.env`. The first start writes that file when it is missing. The site admin at http://127.0.0.1:3000/admin uses the same value. On the hosted API, set `ADMIN_PASSWORD` in the service environment.

The console listens on port **3090**. It stays up when the site and the API are stopped, so those processes can be started from its Services section.

## Ports

| Service | Port | Address |
| --- | --- | --- |
| Admin console | 3090 | http://127.0.0.1:3090 |
| Frontend, including `/admin` | 3000 | http://127.0.0.1:3000 |
| Backend API | 8000 | http://127.0.0.1:8000 |
| Local Supabase API | 54321 | http://127.0.0.1:54321 |
| Local Postgres | 54322 | container `supabase_db_my-macro-app` |

## Two admin screens

Port 3090 starts and stops the frontend and the backend, lists firms on the main screen, opens a **Firm console** overlay for the three-column view (firm list, firm details, advisor/portfolio map), loads new firms with advisors and portfolio assignments, enables or disables firms and advisors, and edits plan caps.

### Load firm CSV

On **Load firm**, use **Choose CSV…** with a file that has a `record_type` column:

| record_type | Use these columns |
| --- | --- |
| `firm` | `firm_name`, `plan_code` (optional, default `pro_plus`) |
| `portfolio` | `portfolio_id`, `name`, `client_master_id`, `sub_account`, `portfolio_value` (optional) |
| `advisor` | `full_name`, `email`, `role` (`owner` or `advisor`), `portfolio_ids` (e.g. `1,2,3` matching `portfolio_id`) |

Advisors must already exist in auth (sign up first). Replace placeholder emails and account ids in `admin/examples/wealth-advisors-group.load-firm.csv` before importing. Disabling a firm disables all of its advisors; re-enabling a firm does not re-enable advisors. Logs are `admin/logs/frontend.log` and `admin/logs/backend.log`.

http://127.0.0.1:3000/admin manages advisors: access, subscription, discounts, the agreement version they accepted, and contact details. It also edits plan caps. The frontend must be on port 3000 and the API on port 8000. That screen does not start those processes.

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
