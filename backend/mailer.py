"""Outbound mail for the public question form.

Local Supabase runs Mailpit, the same catcher Auth uses. A configured SMTP host
is used when one is set. Vercel does not run a mail server.
"""

from __future__ import annotations

import os
import smtplib
import subprocess
from email.message import EmailMessage


def _header(value: str) -> str:
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())


def support_address() -> str:
    return _header(os.getenv("SUPPORT_EMAIL") or "support@hustix.com")


def _supabase_mailpit() -> tuple[str, int] | None:
    """Host and port of the local Supabase mail catcher, if this machine is running it."""
    try:
        out = subprocess.check_output(
            [
                "docker",
                "inspect",
                "-f",
                "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
                "supabase_inbucket_my-macro-app",
            ],
            text=True,
            timeout=3,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None
    host = out.split()[0] if out else ""
    if not host:
        return None
    return host, 1025


def smtp_target() -> tuple[str, int, bool] | None:
    """Where to hand the message, or None when this machine cannot send mail."""
    host = (os.getenv("SMTP_HOST") or "").strip()
    if host:
        port = int(os.getenv("SMTP_PORT") or "587")
        return host, port, port not in {1025, 54325}
    local = _supabase_mailpit()
    if local:
        return local[0], local[1], False
    return None


def build_inquiry_email(name: str, email: str, message: str) -> EmailMessage:
    inbox = support_address()
    sender = _header(os.getenv("SMTP_FROM") or inbox)
    msg = EmailMessage()
    msg["Subject"] = f"Question from {_header(name)}"
    msg["From"] = sender
    msg["To"] = inbox
    msg["Reply-To"] = _header(email)
    msg.set_content(f"Name: {name}\nEmail: {email}\n\n{message}\n")
    return msg


def _deliver(msg: EmailMessage) -> None:
    target = smtp_target()
    if target is None:
        raise RuntimeError("No mail server is available")
    host, port, use_tls = target
    user = os.getenv("SMTP_USER") or ""
    # Resend SMTP password is the API key. Prefer RESEND_API_KEY when both are set
    # so a stale SMTP_PASSWORD does not block delivery.
    password = (os.getenv("RESEND_API_KEY") or os.getenv("SMTP_PASSWORD") or "").strip()

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
        return

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.ehlo()
        if use_tls:
            smtp.starttls()
            smtp.ehlo()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)


def send_inquiry_email(name: str, email: str, message: str) -> None:
    _deliver(build_inquiry_email(name, email, message))


def signup_url(advisor_email: str = "") -> str:
    from urllib.parse import quote

    base = (os.getenv("APP_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "http://127.0.0.1:3000").rstrip("/")
    url = f"{base}/signup"
    address = advisor_email.strip()
    if address:
        url = f"{url}?email={quote(address)}"
    return url


def build_firm_invite_email(firm_name: str, advisor_name: str, advisor_email: str) -> EmailMessage:
    sender = _header(os.getenv("SMTP_FROM") or support_address())
    greeting = _header(advisor_name) if advisor_name.strip() else "there"
    firm = _header(firm_name) or "your firm"
    link = signup_url(advisor_email)
    msg = EmailMessage()
    msg["Subject"] = f"You're invited to {firm} on Hustix Macro"
    msg["From"] = sender
    msg["To"] = _header(advisor_email)
    msg.set_content(
        f"Hi {greeting},\n\n"
        f"You've been added to {firm} on Hustix Macro.\n"
        f"Create your account with this email address ({_header(advisor_email)}) to get access:\n\n"
        f"{link}\n\n"
        f"After you sign up, your firm membership and portfolio assignments will be ready.\n\n"
        f"— Hustix Macro\n"
    )
    return msg


def send_firm_invite_email(firm_name: str, advisor_name: str, advisor_email: str) -> None:
    _deliver(build_firm_invite_email(firm_name, advisor_name, advisor_email))
