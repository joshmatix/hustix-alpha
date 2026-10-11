import base64
import json
import os
from urllib.parse import urlparse

from dotenv import load_dotenv
from supabase.client import Client, create_client

load_dotenv()


def _hostname(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _loopback(url: str) -> bool:
    return _hostname(url) in {"localhost", "127.0.0.1", "::1"}


def _jwt_claims(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


_configured_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
_public_url = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
_anon_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
_on_vercel = bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV"))

# A loopback URL works on the developer machine and refuses connections on Vercel.
if _loopback(_configured_url) and _public_url and not _loopback(_public_url):
    SUPABASE_URL = _public_url
else:
    SUPABASE_URL = _configured_url or _public_url

_hosted = bool(SUPABASE_URL) and not _loopback(SUPABASE_URL)
_service_claims = _jwt_claims(_service_key)
_demo_service_key = _service_claims.get("iss") == "supabase-demo"
# The local demo service-role key is not valid for the hosted project.
if _hosted and _demo_service_key and _anon_key:
    SUPABASE_KEY = _anon_key
else:
    SUPABASE_KEY = _service_key or _anon_key


def _bypasses_rls(key: str) -> bool:
    """True only for a service credential that PostgREST will run as service_role."""
    if key.startswith("sb_secret_"):
        return True
    claims = _jwt_claims(key)
    if claims.get("role") != "service_role":
        return False
    # The local demo key does not authenticate against the hosted project.
    if claims.get("iss") == "supabase-demo" and _hosted:
        return False
    return True

SUPABASE_UNREACHABLE = ""
if not SUPABASE_URL or not SUPABASE_KEY:
    SUPABASE_UNREACHABLE = "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
elif _on_vercel and _loopback(SUPABASE_URL):
    SUPABASE_UNREACHABLE = (
        f"The API is calling Supabase at {SUPABASE_URL}, which is not running on Vercel. "
        "Set SUPABASE_URL to https://<project-ref>.supabase.co and "
        "SUPABASE_SERVICE_ROLE_KEY to that project's service role key."
    )


def authorize_client(client: Client, jwt: str) -> Client:
    # A publishable or anon key has no user id, so inserts fail RLS.
    # The session token is what makes auth.uid() match firm_members.user_id.
    if _bypasses_rls(SUPABASE_KEY):
        return client
    client.options.headers["Authorization"] = f"Bearer {jwt}"
    client.postgrest.auth(jwt)
    return client


def client_for_token(jwt: str) -> Client:
    return authorize_client(create_client(SUPABASE_URL, SUPABASE_KEY), jwt)


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None  # type: ignore[assignment]
