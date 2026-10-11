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
_demo_service_key = _jwt_claims(_service_key).get("iss") == "supabase-demo"
# The local demo service-role key is not valid for the hosted project.
# Fall back to the anon key and run queries as the signed-in user.
USE_USER_JWT = _hosted and _demo_service_key and bool(_anon_key)
SUPABASE_KEY = _anon_key if USE_USER_JWT else (_service_key or _anon_key)

SUPABASE_UNREACHABLE = ""
if not SUPABASE_URL or not SUPABASE_KEY:
    SUPABASE_UNREACHABLE = "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
elif _on_vercel and _loopback(SUPABASE_URL):
    SUPABASE_UNREACHABLE = (
        f"The API is calling Supabase at {SUPABASE_URL}, which is not running on Vercel. "
        "Set SUPABASE_URL to https://<project-ref>.supabase.co and "
        "SUPABASE_SERVICE_ROLE_KEY to that project's service role key."
    )


def client_for_token(jwt: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    if USE_USER_JWT:
        client.postgrest.auth(jwt)
    return client


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None  # type: ignore[assignment]
