import asyncio
import gzip
import socket
from contextlib import aclosing
from unittest.mock import AsyncMock

import httpx
import pytest
from tests.test_workspace_governance import client_account

from app.apps.thought_workshop import link_preview as preview
from app.capabilities.identity.route_permissions import ROUTE_PERMISSIONS
from app.main import app


class Body(httpx.AsyncByteStream):
    def __init__(self, content):
        self.content = content

    async def __aiter__(self):
        yield self.content


def response(content=b"<title>Page</title>", status=200, **headers):
    return httpx.Response(
        status,
        headers={"content-type": "text/html; charset=utf-8", **headers},
        stream=Body(content),
    )


@pytest.fixture
def remote(monkeypatch):
    original_client = httpx.AsyncClient
    resolve = AsyncMock(return_value="93.184.216.34")
    monkeypatch.setattr(preview, "resolve_public", resolve)
    requests = []

    def install(handler):
        def handle(request):
            requests.append(request)
            return handler(request)

        monkeypatch.setattr(
            preview.httpx,
            "AsyncClient",
            lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
        )
        return requests, resolve

    return install


async def test_metadata_priority_pinned_connection_and_no_credentials(remote):
    requests, _ = remote(
        lambda _: response(
            b'<title>Fallback</title><meta property="og:title" content=" A &amp; B ">'
            b'<meta name="description" content="Fallback desc">'
            b'<meta property="og:description" content=" Short   description ">'
        )
    )
    result = await preview.preview_link("https://example.com/docs#section")
    assert result.title == "A & B"
    assert result.description == "Short description"
    assert result.url.endswith("#section")
    assert result.final_url == "https://example.com/docs"
    assert result.domain == "example.com"
    assert result.available
    request = requests[0]
    assert request.url.host == "93.184.216.34"
    assert request.headers["host"] == "example.com"
    assert request.extensions["sni_hostname"] == "example.com"
    assert not any(key in request.headers for key in ("cookie", "authorization", "referer"))


async def test_redirects_revalidate_and_do_not_forward_cookies(remote):
    requests, resolve = remote(
        lambda _: (
            response(
                status=302, location="https://other.example/final", **{"set-cookie": "secret=x"}
            )
            if len(requests) == 1
            else response()
        )
    )
    result = await preview.preview_link("https://example.com")
    assert result.final_url == "https://other.example/final"
    assert resolve.await_count == 2
    assert requests[-1].headers["host"] == "other.example"
    assert "cookie" not in requests[-1].headers


@pytest.mark.parametrize(
    "mode", ["missing", "non-html", "error", "large", "compressed", "redirect-loop"]
)
async def test_unavailable_results_are_safe_fallbacks(remote, mode):
    variants = {
        "missing": lambda: response(b"<p>No metadata</p>"),
        "non-html": lambda: response(**{"content-type": "application/pdf"}),
        "error": lambda: response(status=403),
        "large": lambda: response(b"a" * (preview.MAX_BYTES + 1)),
        "compressed": lambda: response(
            gzip.compress(b"a" * (preview.MAX_BYTES + 1)), **{"content-encoding": "gzip"}
        ),
        "redirect-loop": lambda: response(status=302, location="/again"),
    }
    requests, _ = remote(lambda _: variants[mode]())
    result = await preview.preview_link("https://example.com/docs")
    assert not result.available
    assert result.title is None
    assert result.domain == "example.com"
    assert len(requests) <= 4


async def test_compressed_html_and_plain_title(remote):
    remote(
        lambda _: response(
            gzip.compress(b"<title>Only title</title>"), **{"content-encoding": "gzip"}
        )
    )
    result = await preview.preview_link("https://example.com")
    assert result.available and result.title == "Only title" and result.description is None


@pytest.mark.parametrize(
    "address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "224.0.0.1"]
)
async def test_private_and_special_dns_addresses_rejected(monkeypatch, address):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *_a, **_kw: [(None, None, None, None, (address, 443))]
    )
    with pytest.raises(ValueError):
        await preview.resolve_public(httpx.URL("https://example.com"))


async def test_mixed_public_private_dns_is_rejected(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_a, **_kw: [
            (None, None, None, None, (ip, 443)) for ip in ["93.184.216.34", "10.0.0.1"]
        ],
    )
    with pytest.raises(ValueError):
        await preview.resolve_public(httpx.URL("https://example.com"))


async def test_redirect_to_private_destination_is_not_fetched(remote):
    requests, resolve = remote(lambda _: response(status=302, location="http://127.0.0.1"))
    resolve.side_effect = ["93.184.216.34", ValueError("private")]
    assert not (await preview.preview_link("https://example.com")).available
    assert len(requests) == 1


async def test_timeout_includes_dns_and_cancellation_propagates(monkeypatch):
    async def slow(_):
        await asyncio.sleep(1)

    monkeypatch.setattr(preview, "TIMEOUT", 0.01)
    monkeypatch.setattr(preview, "fetch_metadata", slow)
    assert not (await preview.preview_link("https://example.com")).available
    monkeypatch.setattr(preview, "fetch_metadata", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await preview.preview_link("https://example.com")


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "https://user:pass@example.com", "javascript:alert(1)", "http://[bad"],
)
async def test_invalid_urls_do_not_fetch(monkeypatch, url):
    fetch = AsyncMock()
    monkeypatch.setattr(preview, "fetch_metadata", fetch)
    assert not (await preview.preview_link(url)).available
    fetch.assert_not_awaited()


async def test_metadata_is_inert_and_bounded(remote):
    remote(
        lambda _: response(
            (
                '<meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt;">'
                '<meta name="description" content="' + "x" * 800 + '">'
            ).encode()
        )
    )
    result = await preview.preview_link("https://example.com")
    assert result.title == "<script>alert(1)</script>"
    assert len(result.description) == 600


async def test_api_contract(monkeypatch):
    mock = AsyncMock(
        return_value=preview.ThoughtLinkPreview(
            url="https://example.com",
            final_url="https://example.com",
            domain="example.com",
            title="Example",
            available=True,
        )
    )
    monkeypatch.setattr("app.apps.thought_workshop.routes.preview_link", mock)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get(
            "/v1/thought-workshop/link-preview", params={"url": "https://example.com"}
        )
        assert result.status_code == 200
        assert result.json()["title"] == "Example"
        assert (await client.get("/v1/thought-workshop/link-preview")).status_code == 422
    assert ROUTE_PERMISSIONS[("GET", "/v1/thought-workshop/link-preview")] == "content.read"


@pytest.mark.real_auth
async def test_preview_requires_authentication():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (
            await client.get(
                "/v1/thought-workshop/link-preview", params={"url": "https://example.com"}
            )
        ).status_code == 401


@pytest.mark.real_auth
async def test_read_only_workspace_member_can_preview(monkeypatch):
    owner, _, _, workspace_id = await client_account()
    viewer, username, _, _ = await client_account()
    mock = AsyncMock(
        return_value=preview.ThoughtLinkPreview(
            url="https://example.com", final_url="https://example.com", domain="example.com"
        )
    )
    monkeypatch.setattr("app.apps.thought_workshop.routes.preview_link", mock)
    async with aclosing(owner), aclosing(viewer):
        invitation = await owner.post(
            "/v1/account/workspaces/current/invitations",
            json={"username": username, "role": "viewer"},
        )
        assert invitation.status_code == 201
        inv = invitation.json()
        accepted = await viewer.post(
            f"/v1/account/workspace-invitations/{inv['id']}/accept",
            json={"expected_revision": inv["revision"]},
        )
        assert accepted.status_code == 204
        assert (
            await viewer.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        ).status_code == 200
        assert (await viewer.get("/v1/auth/me")).json()["workspace"]["permission_keys"] == [
            "content.read"
        ]
        result = await viewer.get(
            "/v1/thought-workshop/link-preview", params={"url": "https://example.com"}
        )
        assert result.status_code == 200
        mock.assert_awaited_once()
