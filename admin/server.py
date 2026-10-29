#!/usr/bin/env python3
"""Operator console for Hustix Macro.

The frontend listens on port 3000 and the API on port 8000. This process
listens on port 3090 so it can start either of them after they have been
stopped. Plan caps are the portfolio_limit and ticker_limit columns on
public.plans. An empty value stores NULL, which means that plan is not capped.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
BACKEND_DIR = ROOT / "backend"
LOG_DIR = Path(__file__).resolve().parent / "logs"
ENV_PATH = Path(__file__).resolve().parent / ".env"
PAGE_PATH = Path(__file__).resolve().parent / "index.html"
DB_CONTAINER = "supabase_db_my-macro-app"
HOST = "0.0.0.0"
PORT = 3090
PLAN_CODES = ("free", "pro", "pro_plus", "enterprise")
FIRM_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
MAX_LOAD_FIRM_JSON_BYTES = 3145728
_READ_JSON_CHUNK_BYTES = 65536
SERVICES = {
    "frontend": {
        "label": "Frontend",
        "port": 3000,
        "cwd": FRONTEND_DIR,
    },
    "backend": {
        "label": "Backend",
        "port": 8000,
        "cwd": BACKEND_DIR,
    },
}

_sessions: set[str] = set()
_login_failures: list[float] = []


def _load_env_file(path: Path, *, override: bool = False) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue
        if override or key not in os.environ:
            os.environ[key] = value


_load_env_file(BACKEND_DIR / ".env")
# admin/.env wins for ADMIN_* so cloud URL is not skipped when a blank shell var exists.
_load_env_file(ENV_PATH, override=True)


def _admin_database_url() -> str:
    return (os.getenv("ADMIN_DATABASE_URL") or "").strip()


def _cloud_database_mode() -> bool:
    return bool(_admin_database_url())


def _load_password() -> str:
    existing = ""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith("ADMIN_PASSWORD="):
                existing = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if existing:
        return existing
    password = secrets.token_urlsafe(18)
    ENV_PATH.write_text(f"ADMIN_PASSWORD={password}\n")
    os.chmod(ENV_PATH, 0o600)
    print(f"Wrote a new password to {ENV_PATH}")
    return password


PASSWORD = _load_password()


def _client_ip(handler: BaseHTTPRequestHandler) -> str:
    return handler.client_address[0]


def _too_many_failures() -> bool:
    cutoff = time.time() - 60
    while _login_failures and _login_failures[0] < cutoff:
        _login_failures.pop(0)
    return len(_login_failures) >= 8


def _cookie(handler: BaseHTTPRequestHandler) -> str:
    raw = handler.headers.get("Cookie", "")
    jar = SimpleCookie()
    jar.load(raw)
    morsel = jar.get("macrorisk_admin")
    return morsel.value if morsel else ""


def _signed_in(handler: BaseHTTPRequestHandler) -> bool:
    token = _cookie(handler)
    return bool(token) and token in _sessions


def _same_origin(handler: BaseHTTPRequestHandler) -> bool:
    origin = handler.headers.get("Origin", "")
    if not origin:
        return True
    host = handler.headers.get("Host", "")
    return origin in {f"http://{host}", f"https://{host}"}


def _json_bytes(payload: object, status: int = 200) -> tuple[int, bytes]:
    return status, json.dumps(payload).encode()


def _listeners(port: int) -> list[int]:
    try:
        output = subprocess.check_output(
            ["ss", "-ltnpH", f"sport = :{port}"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [int(pid) for pid in re.findall(r"pid=(\d+)", output)]


def _cwd(pid: int) -> Path | None:
    try:
        return Path(os.readlink(f"/proc/{pid}/cwd"))
    except OSError:
        return None


def _pgid(pid: int) -> int | None:
    try:
        return os.getpgid(pid)
    except OSError:
        return None


def _group_is_inside_repo(pgid: int) -> bool:
    try:
        output = subprocess.check_output(["ps", "-o", "pid=", "-g", str(pgid)], text=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    pids = [int(item) for item in output.split() if item.isdigit()]
    if not pids:
        return False
    for pid in pids:
        cwd = _cwd(pid)
        if cwd is None or ROOT not in cwd.parents and cwd != ROOT:
            return False
    return True


def _service_pid(name: str) -> int | None:
    service = SERVICES[name]
    allowed = service["cwd"]
    for pid in _listeners(service["port"]):
        cwd = _cwd(pid)
        if cwd is not None and (cwd == allowed or allowed in cwd.parents):
            return pid
    return None


def _service_status() -> dict:
    rows = []
    for name, service in SERVICES.items():
        pid = _service_pid(name)
        rows.append({
            "name": name,
            "label": service["label"],
            "port": service["port"],
            "running": pid is not None,
            "pid": pid,
        })
    return {"services": rows}


def _stop_service(name: str) -> dict:
    pid = _service_pid(name)
    if pid is None:
        return {"ok": True, "running": False, "detail": f"{SERVICES[name]['label']} is already stopped."}
    pgid = _pgid(pid)
    if pgid is None or not _group_is_inside_repo(pgid):
        return {"ok": False, "running": True, "detail": "Refused to stop a process outside this project."}
    os.killpg(pgid, signal.SIGTERM)
    deadline = time.time() + 8
    while time.time() < deadline:
        if _service_pid(name) is None:
            return {"ok": True, "running": False, "detail": f"{SERVICES[name]['label']} stopped."}
        time.sleep(0.2)
    os.killpg(pgid, signal.SIGKILL)
    time.sleep(0.3)
    running = _service_pid(name) is not None
    return {
        "ok": not running,
        "running": running,
        "detail": f"{SERVICES[name]['label']} stopped." if not running else "The process did not exit.",
    }


def _port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _start_service(name: str) -> dict:
    if _service_pid(name) is not None:
        return {"ok": True, "running": True, "detail": f"{SERVICES[name]['label']} is already running."}
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{name}.log"
    if name == "frontend":
        command = ["npm", "run", "dev", "--", "--port", "3000", "--hostname", "0.0.0.0"]
        cwd = FRONTEND_DIR
    else:
        uvicorn = BACKEND_DIR / ".venv" / "bin" / "uvicorn"
        if not uvicorn.exists():
            return {"ok": False, "running": False, "detail": "backend/.venv is missing, so the API cannot start."}
        command = [str(uvicorn), "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"]
        cwd = BACKEND_DIR
    with log_path.open("ab") as log:
        subprocess.Popen(
            command,
            cwd=cwd,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    deadline = time.time() + 20
    while time.time() < deadline:
        if _service_pid(name) is not None or _port_open(SERVICES[name]["port"]):
            return {"ok": True, "running": True, "detail": f"{SERVICES[name]['label']} started."}
        time.sleep(0.4)
    return {
        "ok": False,
        "running": _service_pid(name) is not None,
        "detail": f"{SERVICES[name]['label']} did not open port {SERVICES[name]['port']}. See admin/logs/{name}.log.",
    }


def _docker_db_running() -> bool:
    try:
        subprocess.run(
            ["docker", "inspect", DB_CONTAINER],
            capture_output=True,
            check=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def _psql_argv(db_url: str) -> list[str]:
    host_psql = shutil.which("psql")
    if host_psql:
        return [host_psql, db_url, "-v", "ON_ERROR_STOP=1", "-t", "-A"]
    if _docker_db_running():
        return [
            "docker",
            "exec",
            "-i",
            DB_CONTAINER,
            "psql",
            db_url,
            "-v",
            "ON_ERROR_STOP=1",
            "-t",
            "-A",
        ]
    raise RuntimeError(
        "psql is not installed. For ADMIN_DATABASE_URL, install postgresql-client "
        "(sudo apt install postgresql-client) or start local Supabase Docker so "
        f"this console can run psql inside {DB_CONTAINER}."
    )


def _psql(sql: str) -> str:
    db_url = _admin_database_url()
    if db_url:
        env = os.environ.copy()
        env.setdefault("PGSSLMODE", "require")
        completed = subprocess.run(
            _psql_argv(db_url),
            input=sql,
            text=True,
            capture_output=True,
            check=False,
            env=env,
        )
    else:
        completed = subprocess.run(
            [
                "docker", "exec", "-i", DB_CONTAINER,
                "psql", "-U", "postgres", "-d", "postgres",
                "-v", "ON_ERROR_STOP=1", "-t", "-A",
            ],
            input=sql,
            text=True,
            capture_output=True,
            check=False,
        )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Database update failed.").strip()
        lines = [line.strip() for line in detail.splitlines() if line.strip()]
        error_line = next((line for line in lines if line.startswith("ERROR:")), None)
        detail_line = next((line for line in lines if line.startswith("DETAIL:")), None)
        if error_line:
            message = error_line.split(":", 1)[1].strip()
            if detail_line:
                message = f"{message} {detail_line.split(':', 1)[1].strip()}"
            raise RuntimeError(message)
        raise RuntimeError(lines[-1] if lines else "Database update failed.")
    return completed.stdout.strip()


def _database_host() -> str:
    url = _admin_database_url()
    if url:
        return urlparse(url).hostname or "hosted"
    return DB_CONTAINER


def _read_firm_count() -> int:
    raw = _psql("SELECT count(*)::int FROM public.firms;")
    return int((raw or "0").strip() or 0)


def _database_status(firm_count: int | None = None) -> dict:
    hosted = _cloud_database_mode()
    return {
        "mode": "hosted" if hosted else "local",
        "host": _database_host(),
        "firm_count": firm_count,
        "error": None,
    }


def _verify_database_on_startup() -> None:
    hosted = _cloud_database_mode()
    label = "hosted" if hosted else "local Docker"
    print(f"Database target: {label} ({_database_host()})")
    try:
        count = _read_firm_count()
    except RuntimeError as exc:
        print(f"Could not connect to the database: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"Firms in database: {count}")


def _sql_limit(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("A limit must be a whole number, or empty for no cap.")
    if value < 0 or value > 1_000_000:
        raise ValueError("A limit must be between 0 and 1000000, or empty for no cap.")
    return str(value)


def _parse_json_list(raw: str) -> list[dict]:
    text = (raw or "").strip()
    if not text:
        return []
    data = json.loads(text)
    return data if isinstance(data, list) else []


def _read_accounts() -> list[dict]:
    raw = _psql(
        """
        SELECT COALESCE(
          json_agg(
            row
            ORDER BY
              row.signed_in DESC,
              row.last_seen DESC NULLS LAST,
              row.full_name,
              row.email
          ),
          '[]'::json
        )::text
        FROM (
          SELECT
            account_user.id::text AS user_id,
            account_user.email,
            COALESCE(profile.full_name, '') AS full_name,
            COALESCE(account.firm_name, '') AS firm_name,
            COALESCE(account.role, '') AS role,
            COALESCE(account.plan_code, profile.plan, 'free') AS plan_code,
            (open_session.user_id IS NOT NULL) AS signed_in,
            (profile.disabled_at IS NULL) AS enabled,
            NOT EXISTS (
              SELECT 1
              FROM public.firm_members AS member
              JOIN public.firms AS firm ON firm.id = member.firm_id
              WHERE member.user_id = account_user.id
                AND firm.disabled_at IS NOT NULL
            ) AS firm_enabled,
            (account_user.email_confirmed_at IS NOT NULL) AS verified,
            to_char(account_user.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
            to_char(open_session.last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
          FROM auth.users AS account_user
          LEFT JOIN public.profiles AS profile ON profile.id = account_user.id
          LEFT JOIN (
            SELECT
              session.user_id,
              max(GREATEST(
                COALESCE(session.updated_at, session.created_at),
                COALESCE(session.refreshed_at AT TIME ZONE 'UTC', session.created_at)
              )) AS last_seen
            FROM auth.sessions AS session
            WHERE (session.not_after IS NULL OR session.not_after > timezone('utc', now()))
              AND GREATEST(
                COALESCE(session.updated_at, session.created_at),
                COALESCE(session.refreshed_at AT TIME ZONE 'UTC', session.created_at)
              ) > timezone('utc', now()) - interval '8 hours'
              AND EXISTS (
                SELECT 1
                FROM auth.refresh_tokens AS token
                WHERE token.session_id = session.id
                  AND token.revoked IS NOT TRUE
              )
            GROUP BY session.user_id
          ) AS open_session ON open_session.user_id = account_user.id
          LEFT JOIN LATERAL (
            SELECT
              string_agg(firm.name, ', ' ORDER BY (member.role = 'owner') DESC, firm.name) AS firm_name,
              (array_agg(member.role ORDER BY (member.role = 'owner') DESC, member.created_at))[1] AS role,
              (array_agg(subscription.plan_code ORDER BY (member.role = 'owner') DESC, member.created_at))[1] AS plan_code
            FROM public.firm_members AS member
            JOIN public.firms AS firm ON firm.id = member.firm_id
            LEFT JOIN public.subscriptions AS subscription ON subscription.firm_id = firm.id
            WHERE member.user_id = account_user.id
          ) AS account ON true
          WHERE account_user.deleted_at IS NULL
        ) AS row;
        """
    )
    return _parse_json_list(raw)


def _read_plans() -> list[dict]:
    raw = _psql(
        """
        SELECT COALESCE(json_agg(row ORDER BY row.monthly_cents NULLS LAST, row.code), '[]'::json)::text
        FROM (
          SELECT code, name, monthly_cents, portfolio_limit, ticker_limit
          FROM public.plans
        ) AS row;
        """
    )
    return json.loads(raw or "[]")


def _read_firms() -> list[dict]:
    raw = _psql(
        """
        SELECT COALESCE(json_agg(row ORDER BY row.name), '[]'::json)::text
        FROM (
          SELECT
            firm.id::text AS id,
            firm.public_id,
            firm.name,
            COALESCE(subscription.plan_code, 'free') AS plan_code,
            COALESCE(subscription.status, '') AS subscription_status,
            (firm.disabled_at IS NULL) AS enabled,
            (
              SELECT count(*)::int
              FROM public.firm_members AS member
              WHERE member.firm_id = firm.id
            ) AS member_count,
            (
              SELECT count(*)::int
              FROM public.portfolios AS portfolio
              WHERE portfolio.firm_id = firm.id
            ) AS portfolio_count,
            to_char(firm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_on
          FROM public.firms AS firm
          LEFT JOIN public.subscriptions AS subscription
            ON subscription.firm_id = firm.id
        ) AS row;
        """
    )
    return json.loads(raw or "[]")


def _parse_firm_id(value: str) -> str:
    if not FIRM_ID.fullmatch(value or ""):
        raise ValueError("Invalid firm id.")
    return value.lower()


def _parse_user_id(value: str) -> str:
    return _parse_firm_id(value)


def _set_holdings_classification_source(firm_id: str, source: str) -> None:
    fid = _parse_firm_id(firm_id)
    normalized = str(source or "").strip().lower()
    if normalized not in {"csv", "authoritative"}:
        raise ValueError("Source must be csv or authoritative.")
    _psql(
        f"UPDATE public.firms SET holdings_classification_source = '{normalized}' "
        f"WHERE id = '{fid}'::uuid;"
    )


def _set_firm_access(firm_id: str, enabled: bool) -> None:
    fid = _parse_firm_id(firm_id)
    flag = "true" if enabled else "false"
    _psql(f"SELECT public.admin_set_firm_access('{fid}'::uuid, {flag});")


def _delete_firm(firm_id: str) -> dict:
    fid = _parse_firm_id(firm_id)
    raw = _psql(f"SELECT public.admin_delete_firm('{fid}'::uuid)::text;")
    deleted = json.loads(raw or "{}")
    return {"ok": True, "deleted": deleted, "firms": _read_firms()}


def _set_advisor_access(user_id: str, enabled: bool) -> None:
    uid = _parse_user_id(user_id)
    flag = "true" if enabled else "false"
    _psql(f"SELECT public.admin_set_advisor_access('{uid}'::uuid, {flag});")


def _delete_advisor(user_id: str) -> dict:
    uid = _parse_user_id(user_id)
    raw = _psql(f"SELECT public.admin_delete_advisor('{uid}'::uuid)::text;")
    deleted = json.loads(raw or "{}")
    return {
        "ok": True,
        "deleted": deleted,
        "firms": _read_firms(),
        "accounts": _read_accounts(),
    }


def _sql_json_literal(payload: object) -> str:
    blob = json.dumps(payload, separators=(",", ":"))
    return "'" + blob.replace("'", "''") + "'::jsonb"


def _normalize_load_firm_payload(payload: dict) -> dict:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    from admin_firm_load import normalize_load_firm_payload  # type: ignore

    return normalize_load_firm_payload(payload)


def _send_firm_invites(firm_name: str, invited_emails: list[str], advisors: list[dict]) -> dict:
    """Email unsigned advisors to sign up. Returns counts for the UI."""
    names = {
        str(row.get("email") or row.get("advisor_email") or "").strip().lower(): str(
            row.get("full_name") or row.get("advisor_name") or ""
        )
        for row in advisors
        if isinstance(row, dict)
    }
    emailed = 0
    failed: list[str] = []
    try:
        import sys

        if str(BACKEND_DIR) not in sys.path:
            sys.path.insert(0, str(BACKEND_DIR))
        from mailer import send_firm_invite_email  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return {"emailed": 0, "failed": invited_emails, "detail": str(exc)}

    for email in invited_emails:
        address = str(email or "").strip().lower()
        if not address:
            continue
        try:
            send_firm_invite_email(firm_name, names.get(address, ""), address)
            emailed += 1
        except Exception:  # noqa: BLE001
            failed.append(address)
    return {"emailed": emailed, "failed": failed}


def _load_firm(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid request.")
    normalized = _normalize_load_firm_payload(payload)
    raw = _psql(f"SELECT public.admin_load_firm({_sql_json_literal(normalized)})::text;")
    result = json.loads(raw or "{}")
    firm_id = result.get("firm_id")
    if not firm_id:
        raise RuntimeError("Firm was not created.")
    detail = _read_firm_detail(str(firm_id))
    if detail is None:
        raise RuntimeError("Firm was created but could not be loaded.")
    invited_emails = result.get("invited_emails") or []
    if not isinstance(invited_emails, list):
        invited_emails = []
    invite_mail = {"emailed": 0, "failed": []}
    if invited_emails:
        invite_mail = _send_firm_invites(
            str(normalized.get("firm_name") or ""),
            [str(item) for item in invited_emails],
            list(normalized.get("advisors") or []),
        )
    return {
        "ok": True,
        "firm_id": firm_id,
        "public_id": result.get("public_id"),
        "firm": detail,
        "firms": _read_firms(),
        "invited_count": result.get("invited_count") or len(invited_emails),
        "invite_mail": invite_mail,
    }


def _add_firm_advisor(firm_id: str, payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid request.")
    fid = _parse_firm_id(firm_id)
    email = str(payload.get("email") or payload.get("advisor_email") or "").strip()
    full_name = str(payload.get("full_name") or payload.get("advisor_name") or "").strip()
    role = str(payload.get("role") or "advisor").strip() or "advisor"
    if not email:
        raise ValueError("Advisor email is required.")
    raw = _psql(
        "SELECT public.admin_add_firm_advisor("
        f"'{fid}'::uuid, {_sql_text_literal(email)}, {_sql_text_literal(full_name)}, {_sql_text_literal(role)}"
        ")::text;"
    )
    created = json.loads(raw or "{}")
    detail = _read_firm_detail(fid)
    pending = bool(created.get("pending"))
    invite_mail = {"emailed": 0, "failed": []}
    if pending:
        firm_name = (detail or {}).get("name") or ""
        invite_mail = _send_firm_invites(
            firm_name,
            [str(created.get("email") or email)],
            [{"email": email, "full_name": full_name}],
        )
    return {
        "ok": True,
        "firm": detail,
        "firms": _read_firms(),
        "pending": pending,
        "invite_mail": invite_mail,
    }


def _sql_text_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _assign_portfolio_advisor(portfolio_id: str, payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid request.")
    pid = _parse_firm_id(portfolio_id)
    user_id = str(payload.get("user_id") or "").strip()
    if not FIRM_ID.fullmatch(user_id):
        raise ValueError("Invalid user id.")
    make_lead = bool(payload.get("is_lead"))
    flag = "true" if make_lead else "false"
    _psql(
        "SELECT public.admin_assign_portfolio_advisor("
        f"'{pid}'::uuid, '{user_id.lower()}'::uuid, {flag}"
        ")::text;"
    )
    firm_id = payload.get("firm_id")
    detail = _read_firm_detail(str(firm_id)) if isinstance(firm_id, str) and FIRM_ID.fullmatch(firm_id) else None
    if detail is None:
        firm_id = _firm_id_for_portfolio(pid)
        detail = _read_firm_detail(firm_id) if firm_id else None
    return {"ok": True, "firm": detail, "firms": _read_firms()}


def _remove_portfolio_advisor(portfolio_id: str, user_id: str, firm_id: str | None = None) -> dict:
    pid = _parse_firm_id(portfolio_id)
    uid = _parse_user_id(user_id)
    _psql(
        "SELECT public.admin_remove_portfolio_advisor("
        f"'{pid}'::uuid, '{uid}'::uuid"
        ")::text;"
    )
    detail = None
    if firm_id and FIRM_ID.fullmatch(firm_id):
        detail = _read_firm_detail(firm_id)
    if detail is None:
        resolved = _firm_id_for_portfolio(pid)
        detail = _read_firm_detail(resolved) if resolved else None
    return {"ok": True, "firm": detail, "firms": _read_firms()}


def _firm_id_for_portfolio(portfolio_id: str) -> str | None:
    raw = _psql(
        f"SELECT firm_id::text FROM public.portfolios WHERE id = '{portfolio_id}'::uuid LIMIT 1;"
    )
    value = (raw or "").strip()
    return value or None


def _read_firm_detail(firm_id: str) -> dict | None:
    fid = _parse_firm_id(firm_id)
    raw = _psql(
        f"""
        SELECT row_to_json(detail)::text
        FROM (
          SELECT
            firm.id::text AS id,
            firm.public_id,
            firm.name,
            firm.holdings_classification_source,
            to_char(firm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_on,
            COALESCE(subscription.plan_code, 'free') AS plan_code,
            COALESCE(subscription.status, 'active') AS subscription_status,
            (firm.disabled_at IS NULL) AS enabled,
            plan.portfolio_limit,
            plan.ticker_limit,
            (
              SELECT COALESCE(sum(portfolio.portfolio_value), 0)::float8
              FROM public.portfolios AS portfolio
              WHERE portfolio.firm_id = firm.id
            ) AS total_aum,
            (
              SELECT count(*)::int
              FROM public.firm_members AS member
              WHERE member.firm_id = firm.id
            ) AS advisor_count,
            (
              SELECT count(*)::int
              FROM public.portfolios AS portfolio
              WHERE portfolio.firm_id = firm.id
            ) AS portfolio_count,
            (
              SELECT COALESCE(json_agg(advisor ORDER BY advisor.full_name, advisor.email), '[]'::json)
              FROM (
                SELECT
                  account_user.id::text AS user_id,
                  COALESCE(NULLIF(btrim(profile.full_name), ''), account_user.email) AS full_name,
                  account_user.email,
                  member.role,
                  (profile.disabled_at IS NULL) AS enabled,
                  false AS pending
                FROM public.firm_members AS member
                JOIN auth.users AS account_user ON account_user.id = member.user_id
                LEFT JOIN public.profiles AS profile ON profile.id = account_user.id
                WHERE member.firm_id = firm.id
                  AND account_user.deleted_at IS NULL
              ) AS advisor
            ) AS advisors,
            (
              SELECT COALESCE(json_agg(invite ORDER BY invite.full_name, invite.email), '[]'::json)
              FROM (
                SELECT
                  pending.id::text AS invite_id,
                  pending.full_name,
                  pending.email,
                  pending.role,
                  true AS pending,
                  to_char(pending.invited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS invited_on,
                  (
                    SELECT COALESCE(
                      json_agg(
                        json_build_object(
                          'portfolio_id', link.portfolio_id::text,
                          'name', portfolio.name,
                          'is_lead', link.is_lead
                        )
                        ORDER BY link.is_lead DESC, portfolio.name
                      ),
                      '[]'::json
                    )
                    FROM public.firm_advisor_invite_portfolios AS link
                    JOIN public.portfolios AS portfolio ON portfolio.id = link.portfolio_id
                    WHERE link.invite_id = pending.id
                  ) AS portfolios
                FROM public.firm_advisor_invites AS pending
                WHERE pending.firm_id = firm.id
                  AND pending.accepted_at IS NULL
              ) AS invite
            ) AS pending_advisors,
            (
              SELECT COALESCE(json_agg(portfolio_row ORDER BY portfolio_row.name), '[]'::json)
              FROM (
                SELECT
                  portfolio.id::text AS id,
                  portfolio.name,
                  COALESCE(portfolio.portfolio_value, 0)::float8 AS portfolio_value,
                  (
                    SELECT COALESCE(
                      json_agg(
                        json_build_object(
                          'user_id', assignment.user_id::text,
                          'full_name', COALESCE(NULLIF(btrim(assignee_profile.full_name), ''), assignee.email),
                          'is_lead', assignment.is_lead
                        )
                        ORDER BY assignment.is_lead DESC, assignee_profile.full_name, assignee.email
                      ),
                      '[]'::json
                    )
                    FROM public.portfolio_advisors AS assignment
                    JOIN auth.users AS assignee ON assignee.id = assignment.user_id
                    LEFT JOIN public.profiles AS assignee_profile ON assignee_profile.id = assignee.id
                    WHERE assignment.portfolio_id = portfolio.id
                  ) AS advisors
                FROM public.portfolios AS portfolio
                WHERE portfolio.firm_id = firm.id
              ) AS portfolio_row
            ) AS portfolios
          FROM public.firms AS firm
          LEFT JOIN public.subscriptions AS subscription ON subscription.firm_id = firm.id
          LEFT JOIN public.plans AS plan ON plan.code = COALESCE(subscription.plan_code, 'free')
          WHERE firm.id = '{fid}'::uuid
        ) AS detail;
        """
    )
    if not raw:
        return None
    return json.loads(raw)


def _write_limits(plans: object) -> list[dict]:
    if not isinstance(plans, list) or not plans:
        raise ValueError("Send one row per plan.")
    seen: set[str] = set()
    statements = ["BEGIN;"]
    for row in plans:
        if not isinstance(row, dict):
            raise ValueError("Each plan row must be an object.")
        code = row.get("code")
        if code not in PLAN_CODES or code in seen:
            raise ValueError("Unknown plan.")
        seen.add(code)
        portfolio = _sql_limit(row.get("portfolio_limit"))
        ticker = _sql_limit(row.get("ticker_limit"))
        statements.append(
            "UPDATE public.plans "
            f"SET portfolio_limit = {portfolio}, ticker_limit = {ticker} "
            f"WHERE code = '{code}';"
        )
    if seen != set(PLAN_CODES):
        raise ValueError("Save every plan together.")
    statements.append("COMMIT;")
    _psql("\n".join(statements))
    return _read_plans()


class Handler(BaseHTTPRequestHandler):
    server_version = "HustixMacro/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[admin] {self.address_string()} {fmt % args}")

    def _send(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> object:
        max_bytes = MAX_LOAD_FIRM_JSON_BYTES
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > max_bytes:
            raise ValueError("Request is too large.")
        if length > 0:
            raw = self.rfile.read(length)
            if len(raw) > max_bytes:
                raise ValueError("Request is too large.")
        else:
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = self.rfile.read(_READ_JSON_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError("Request is too large.")
                chunks.append(chunk)
            raw = b"".join(chunks)
        if not raw:
            return {}
        return json.loads(raw.decode())

    def _require_auth(self) -> bool:
        if _signed_in(self):
            return True
        body = json.dumps({"detail": "Sign in required."}).encode()
        self._send(401, body, "application/json")
        return False

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            page = PAGE_PATH.read_bytes()
            self._send(200, page, "text/html; charset=utf-8")
            return
        if path == "/api/session":
            self._send(*_json_bytes({"signed_in": _signed_in(self)}), "application/json")
            return
        if path == "/api/state":
            if not self._require_auth():
                return
            try:
                firms = _read_firms()
                payload = {
                    "plans": _read_plans(),
                    "firms": firms,
                    "accounts": _read_accounts(),
                    "cloud_mode": _cloud_database_mode(),
                    "database": _database_status(len(firms)),
                    **_service_status(),
                }
                self._send(*_json_bytes(payload), "application/json")
            except RuntimeError as exc:
                self._send(*_json_bytes({"detail": str(exc)}, 503), "application/json")
            return
        if path.startswith("/api/firms/"):
            if not self._require_auth():
                return
            firm_id = path.removeprefix("/api/firms/").strip("/")
            try:
                detail = _read_firm_detail(firm_id)
            except ValueError as exc:
                self._send(*_json_bytes({"detail": str(exc)}, 400), "application/json")
                return
            except RuntimeError as exc:
                self._send(*_json_bytes({"detail": str(exc)}, 503), "application/json")
                return
            if detail is None:
                self._send(*_json_bytes({"detail": "Firm not found."}, 404), "application/json")
                return
            self._send(*_json_bytes(detail), "application/json")
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/login":
            self._login()
            return
        if not _same_origin(self):
            self._send(*_json_bytes({"detail": "Origin was rejected."}, 403), "application/json")
            return
        if path == "/api/logout":
            token = _cookie(self)
            _sessions.discard(token)
            self._send(*_json_bytes({"ok": True}), "application/json", {"Set-Cookie": "macrorisk_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
            return
        if not self._require_auth():
            return
        try:
            payload = self._read_json()
        except (json.JSONDecodeError, ValueError) as exc:
            self._send(*_json_bytes({"detail": str(exc) or "Invalid request."}, 400), "application/json")
            return
        try:
            if path == "/api/firms/load":
                result = _load_firm(payload)
                self._send(*_json_bytes(result), "application/json")
                return
            firm_class = re.fullmatch(
                r"/api/firms/([0-9a-f-]{36})/holdings-classification", path, re.IGNORECASE
            )
            if firm_class:
                if not isinstance(payload, dict) or "source" not in payload:
                    raise ValueError("Send source: csv or authoritative.")
                firm_id = firm_class.group(1)
                _set_holdings_classification_source(firm_id, str(payload["source"]))
                detail = _read_firm_detail(firm_id)
                self._send(
                    *_json_bytes({"ok": True, "firm": detail, "firms": _read_firms()}),
                    "application/json",
                )
                return
            firm_access = re.fullmatch(r"/api/firms/([0-9a-f-]{36})/access", path, re.IGNORECASE)
            if firm_access:
                if not isinstance(payload, dict) or "enabled" not in payload:
                    raise ValueError("Send enabled: true or false.")
                firm_id = firm_access.group(1)
                _set_firm_access(firm_id, bool(payload["enabled"]))
                detail = _read_firm_detail(firm_id)
                self._send(
                    *_json_bytes({"ok": True, "firm": detail, "firms": _read_firms()}),
                    "application/json",
                )
                return
            advisor_delete = re.fullmatch(r"/api/advisors/([0-9a-f-]{36})/delete", path, re.IGNORECASE)
            if advisor_delete:
                user_id = advisor_delete.group(1)
                result = _delete_advisor(user_id)
                refresh_firm = payload.get("firm_id") if isinstance(payload, dict) else None
                if isinstance(refresh_firm, str) and FIRM_ID.fullmatch(refresh_firm):
                    result["firm"] = _read_firm_detail(refresh_firm)
                self._send(*_json_bytes(result), "application/json")
                return
            advisor_access = re.fullmatch(r"/api/advisors/([0-9a-f-]{36})/access", path, re.IGNORECASE)
            if advisor_access:
                if not isinstance(payload, dict) or "enabled" not in payload:
                    raise ValueError("Send enabled: true or false.")
                user_id = advisor_access.group(1)
                _set_advisor_access(user_id, bool(payload["enabled"]))
                detail = None
                refresh_firm = payload.get("firm_id") if isinstance(payload, dict) else None
                if isinstance(refresh_firm, str) and FIRM_ID.fullmatch(refresh_firm):
                    detail = _read_firm_detail(refresh_firm)
                self._send(
                    *_json_bytes(
                        {
                            "ok": True,
                            "firm": detail,
                            "firms": _read_firms(),
                            "accounts": _read_accounts(),
                        }
                    ),
                    "application/json",
                )
                return
            firm_advisors = re.fullmatch(r"/api/firms/([0-9a-f-]{36})/advisors", path, re.IGNORECASE)
            if firm_advisors:
                result = _add_firm_advisor(firm_advisors.group(1), payload)
                self._send(*_json_bytes(result), "application/json")
                return
            portfolio_advisors = re.fullmatch(
                r"/api/portfolios/([0-9a-f-]{36})/advisors", path, re.IGNORECASE
            )
            if portfolio_advisors:
                result = _assign_portfolio_advisor(portfolio_advisors.group(1), payload)
                self._send(*_json_bytes(result), "application/json")
                return
            if path == "/api/limits":
                plans = _write_limits(payload.get("plans") if isinstance(payload, dict) else None)
                self._send(*_json_bytes({"plans": plans}), "application/json")
                return
            if path == "/api/service":
                if _cloud_database_mode():
                    raise ValueError("Services are disabled when ADMIN_DATABASE_URL is set.")
                if not isinstance(payload, dict):
                    raise ValueError("Invalid request.")
                name = payload.get("name")
                action = payload.get("action")
                if name not in SERVICES or action not in {"start", "stop"}:
                    raise ValueError("Unknown service or action.")
                result = _start_service(name) if action == "start" else _stop_service(name)
                status = 200 if result["ok"] else 500
                self._send(*_json_bytes({**result, **_service_status()}, status), "application/json")
                return
        except ValueError as exc:
            self._send(*_json_bytes({"detail": str(exc)}, 422), "application/json")
            return
        except RuntimeError as exc:
            detail = str(exc)
            status = 422 if "ERROR:" in detail or "exception" in detail.lower() else 503
            # Strip psql ERROR: prefix for the UI.
            if detail.startswith("ERROR:"):
                detail = detail.split(":", 1)[1].strip()
            self._send(*_json_bytes({"detail": detail}, status), "application/json")
            return
        except Exception as exc:  # noqa: BLE001 — keep the browser from seeing Failed to fetch
            self._send(*_json_bytes({"detail": str(exc)}, 500), "application/json")
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if not _same_origin(self):
            self._send(*_json_bytes({"detail": "Origin was rejected."}, 403), "application/json")
            return
        if not self._require_auth():
            return
        firm_delete = re.fullmatch(r"/api/firms/([0-9a-f-]{36})", path, re.IGNORECASE)
        if firm_delete:
            try:
                result = _delete_firm(firm_delete.group(1))
                self._send(*_json_bytes(result), "application/json")
            except ValueError as exc:
                self._send(*_json_bytes({"detail": str(exc)}, 422), "application/json")
            except RuntimeError as exc:
                detail = str(exc)
                if detail.startswith("ERROR:"):
                    detail = detail.split(":", 1)[1].strip()
                self._send(*_json_bytes({"detail": detail}, 422), "application/json")
            return
        match = re.fullmatch(
            r"/api/portfolios/([0-9a-f-]{36})/advisors/([0-9a-f-]{36})",
            path,
            re.IGNORECASE,
        )
        if not match:
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        query = parse_qs(urlparse(self.path).query)
        firm_id = (query.get("firm_id") or [None])[0]
        try:
            result = _remove_portfolio_advisor(match.group(1), match.group(2), firm_id)
            self._send(*_json_bytes(result), "application/json")
        except ValueError as exc:
            self._send(*_json_bytes({"detail": str(exc)}, 422), "application/json")
        except RuntimeError as exc:
            detail = str(exc)
            if detail.startswith("ERROR:"):
                detail = detail.split(":", 1)[1].strip()
            self._send(*_json_bytes({"detail": detail}, 422), "application/json")

    def _login(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode() if length else ""
        supplied = ""
        content_type = self.headers.get("Content-Type", "")
        if "application/json" in content_type:
            try:
                supplied = str(json.loads(raw or "{}").get("password", ""))
            except json.JSONDecodeError:
                supplied = ""
        else:
            supplied = parse_qs(raw).get("password", [""])[0]
        if _too_many_failures():
            self._send(*_json_bytes({"detail": "Too many attempts. Wait a minute."}, 429), "application/json")
            return
        if not hmac.compare_digest(supplied, PASSWORD):
            _login_failures.append(time.time())
            self._send(*_json_bytes({"detail": "Wrong password."}, 401), "application/json")
            return
        token = secrets.token_urlsafe(32)
        _sessions.add(token)
        cookie = f"macrorisk_admin={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200"
        self._send(*_json_bytes({"ok": True}), "application/json", {"Set-Cookie": cookie})


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _verify_database_on_startup()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Admin console on http://{HOST}:{PORT}")
    print("Frontend port 3000. Backend port 8000.")
    server.serve_forever()


if __name__ == "__main__":
    main()
