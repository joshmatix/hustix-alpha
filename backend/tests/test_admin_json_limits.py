import pytest
from fastapi import HTTPException

from admin_firm_load import JSON_TOO_LARGE_MESSAGE, MAX_LOAD_FIRM_JSON_BYTES, read_bounded_json


class _FakeStream:
    def __init__(self, chunks: list[bytes]):
        self._chunks = list(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)


class _FakeRequest:
    def __init__(self, chunks: list[bytes], content_length: str | None = None):
        self.headers = {"content-length": content_length} if content_length is not None else {}
        self._chunks = chunks

    async def stream(self):
        for chunk in self._chunks:
            yield chunk


@pytest.mark.asyncio
async def test_read_bounded_json_accepts_payload_under_limit():
    body = b'{"firm_name":"Acme","advisors":[{"email":"a@example.com"}]}'
    parsed = await read_bounded_json(_FakeRequest([body], str(len(body))))
    assert parsed["firm_name"] == "Acme"


@pytest.mark.asyncio
async def test_read_bounded_json_rejects_oversized_content_length():
    with pytest.raises(HTTPException) as exc:
        await read_bounded_json(_FakeRequest([], str(MAX_LOAD_FIRM_JSON_BYTES + 1)))
    assert exc.value.status_code == 413
    assert exc.value.detail == JSON_TOO_LARGE_MESSAGE


@pytest.mark.asyncio
async def test_read_bounded_json_rejects_oversized_stream():
    chunk = b"x" * (MAX_LOAD_FIRM_JSON_BYTES + 1)
    with pytest.raises(HTTPException) as exc:
        await read_bounded_json(_FakeRequest([chunk]))
    assert exc.value.status_code == 413
