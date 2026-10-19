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
