"""Only the native loopback lane accepts a protected collector credential."""

import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from fpl_host.transport import LeaseEnded, NativeTransport, ProtocolConflict
from fpl_runtime.request_limit import RequestLimit


@pytest.mark.parametrize(
    "base",
    [
        "https://127.0.0.1:29090/agents",
        "http://localhost:29090/agents",
        "http://example.org:29090/agents",
        "http://127.0.0.1:29090/agents?secret=no",
        "http://name:password@127.0.0.1:29090/agents",
        "http://127.0.0.1:29090/remote",
    ],
)
def test_native_client_rejects_ambiguous_or_nonloopback_endpoints(base):
    with pytest.raises(ValueError):
        NativeTransport(base_url=base, credential="fixture" * 10)


async def test_native_client_keeps_path_auth_and_does_not_follow_redirects():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "http://external.example"})

    client = NativeTransport(
        base_url="http://127.0.0.1:29090/agents",
        credential="fixture" * 10,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await client.post("claim", {"wait_seconds": 0})
        assert len(requests) == 1
        assert requests[0].url.path == "/agents/_native/v1/claim"
        assert requests[0].headers["authorization"] == "Bearer " + "fixture" * 10
        assert "x-fpl-native-ingress" not in requests[0].headers
    finally:
        await client.close()


@pytest.mark.parametrize(
    "code,error",
    [(403, LeaseEnded), (410, LeaseEnded), (409, ProtocolConflict), (422, ProtocolConflict)],
)
async def test_native_client_refuses_retrying_rejected_receipts(code, error):
    client = NativeTransport(
        base_url="http://127.0.0.1:29090/agents",
        credential="fixture" * 10,
        transport=httpx.MockTransport(lambda _request: httpx.Response(code)),
    )
    try:
        with pytest.raises(error):
            await client.post("projection", {})
    finally:
        await client.close()


async def test_private_request_body_is_bounded_before_json_parsing():
    async def read(request):
        return JSONResponse(await request.json())

    app = RequestLimit(
        Starlette(routes=[Route("/_native/test", read, methods=["POST"])]),
        prefix="/_native/",
        maximum=20,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://fixture"
    ) as client:
        assert (await client.post("/_native/test", json={"ok": True})).status_code == 200
        response = await client.post("/_native/test", json={"text": "a" * 100})
        assert response.status_code == 413
        assert response.headers["cache-control"] == "no-store"
