from mailer import build_inquiry_email
from routers.support import Inquiry, clean_inquiry


def test_clean_inquiry_requires_name_email_and_message():
    assert clean_inquiry(Inquiry(name="  Ada  ", email="ada@example.com", message=" How does it work? ")) == (
        "Ada",
        "ada@example.com",
        "How does it work?",
    )
    assert clean_inquiry(Inquiry(name="Ada", email="not-an-email", message="Hello")) is None
    assert clean_inquiry(Inquiry(name="   ", email="ada@example.com", message="Hello")) is None
    assert clean_inquiry(Inquiry(name="Ada", email="ada@example.com", message="   ")) is None


def test_inquiry_email_goes_to_support_and_replies_to_the_visitor(monkeypatch):
    monkeypatch.setenv("SUPPORT_EMAIL", "support@hustix.com")
    monkeypatch.delenv("SMTP_FROM", raising=False)
    msg = build_inquiry_email("Ada\r\nBcc: bad@evil.com", "ada@example.com", "How does it work?")
    assert msg["To"] == "support@hustix.com"
    assert msg["Reply-To"] == "ada@example.com"
    assert "\n" not in msg["Subject"]
    assert "\r" not in msg["Subject"]
