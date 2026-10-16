from routers.admin import session_valid, sign_session


def test_session_cookie_round_trip():
    token = sign_session("secret", 2_000)
    assert session_valid("secret", token, now=1_999)
    assert not session_valid("secret", token, now=2_000)
    assert not session_valid("other", token, now=1_999)
    assert not session_valid("secret", "nope", now=1_999)
