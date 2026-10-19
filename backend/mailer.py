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


def _smtp_target() -> tuple[str, int, bool]:
    host = (os.getenv("SMTP_HOST") or "").strip()
    if host:
        port = int(os.getenv("SMTP_PORT") or "587")
        return host, port, port not in {1025, 54325}
    local = _supabase_mailpit()
    if local:
        return local[0], local[1], False
    raise RuntimeError("No mail server is available")


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


def send_inquiry_email(name: str, email: str, message: str) -> None:
    host, port, use_tls = _smtp_target()
    user = os.getenv("SMTP_USER") or ""
    password = os.getenv("SMTP_PASSWORD") or ""
    msg = build_inquiry_email(name, email, message)

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
