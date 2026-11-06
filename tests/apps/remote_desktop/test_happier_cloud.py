import asyncio
from contextlib import aclosing, asynccontextmanager

import httpx
import pytest

from studio.apps.identity.use_cases.happier_access import BROWSER_COOKIE
from studio.assembly.website import happier_ingress
from studio.assembly.website.happier import Happier
from studio.config.settings import get_settings
from tests.apps.remote_desktop.test_cloud_control import CLOUD, admin_client, configure, unlock
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


class RelayPage(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"Happier"


@pytest.mark.parametrize("end_grant", ["logout", "revoke", "expiry"])
async def test_happier_exchange_and_relay_use_real_fpl_session(monkeypatch, end_grant):
    admin, owner = await admin_client(local=False)
    other, other_id = await admin_client(local=False)
    configure(monkeypatch, owner, other_id)
    settings = get_settings().model_copy(
        update={
            "fpl_remote_web_origin": "https://test",
            "fpl_happier_origin": "https://happier.test",
            "fpl_happier_admin_user_id": owner,
        }
    )
    happier = Happier(settings, SessionLocal, read_cloud_settings=get_settings)
    monkeypatch.setattr(app.state, "happier", happier)
    ingress = happier.ingress()

    policy = "plaintext_only"

    async def upstream(request):
        assert BROWSER_COOKIE not in request.headers.get("cookie", "")
        if request.url.path == "/v1/features":
            return httpx.Response(
                200, json={"capabilities": {"encryption": {"storagePolicy": policy}}}
            )
        return httpx.Response(200, stream=RelayPage(), headers={"Content-Type": "text/html"})

    await ingress.client.aclose()
    ingress.client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    async with (
        aclosing(admin),
        aclosing(other),
        ingress.client,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(ingress), base_url=happier.access.origin
        ) as browser,
    ):
        launch = CLOUD + "/happier/launch"
        assert (await admin.get("/v1/agent-workbench/sessions")).status_code == 404
        assert (await admin.post("/v1/agent-workbench/chats", json={})).status_code == 404
        assert (await browser.get("/")).status_code == 403
        assert (await admin.post(launch)).status_code == 403
        await unlock(admin)
        await unlock(other)
        assert (await other.post(launch)).status_code == 403
        assert (await admin.post(launch, headers={"X-CSRF-Token": "wrong"})).status_code == 403
        assert (await admin.get(CLOUD + "/status")).json()["happier_available"]

        launched = await admin.post(launch)
        assert launched.status_code == 200, launched.text
        value = launched.json()
        form = {"ticket": value["ticket"]}
        assert (await browser.post(value["exchange_url"], data=form)).status_code == 403
        browser.headers["Origin"] = "https://test"
        assert (await browser.post(value["exchange_url"], data=form)).status_code == 503
        assert (await browser.get("/")).status_code == 403
        policy = "required_e2ee"
        value = (await admin.post(launch)).json()
        form = {"ticket": value["ticket"]}
        exchange = await browser.post(value["exchange_url"], data=form)
        assert exchange.status_code == 204
        assert exchange.headers["access-control-allow-origin"] == "https://test"
        cookie = exchange.headers["set-cookie"]
        assert all(flag in cookie for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"))
        assert (await browser.post(value["exchange_url"], data=form)).status_code == 403
        page = await browser.get("/")
        assert page.text == "Happier"
        assert page.headers["content-security-policy"] == "frame-ancestors https://test"
        assert page.headers["cache-control"] == "no-store"
        assert (await browser.post("/v1/updates?transport=polling")).status_code == 403

        assert await close_after_revocation(ingress, browser, admin, monkeypatch, end_grant) == 1008
        assert (await browser.get("/")).status_code == 403


async def close_after_revocation(ingress, browser, admin, monkeypatch, end_grant):
    class RelaySocket:
        async def __aiter__(self):
            yield "initial relay frame"
            await asyncio.Future()

    @asynccontextmanager
    async def connect(*_args, **_kwargs):
        yield RelaySocket()

    monkeypatch.setattr(happier_ingress, "connect", connect)
    incoming, outgoing = asyncio.Queue(), asyncio.Queue()
    await incoming.put({"type": "websocket.connect"})
    cookie = BROWSER_COOKIE + "=" + browser.cookies.get(BROWSER_COOKIE)
    scope = {
        "type": "websocket",
        "scheme": "wss",
        "path": "/v1/updates",
        "query_string": b"transport=websocket",
        "headers": [
            (b"host", b"happier.test"),
            (b"origin", b"https://happier.test"),
            (b"cookie", cookie.encode()),
        ],
    }
    task = asyncio.create_task(ingress(scope, incoming.get, outgoing.put))
    try:
        assert (await asyncio.wait_for(outgoing.get(), 3))["type"] == "websocket.accept"
        assert (await asyncio.wait_for(outgoing.get(), 3))["text"] == "initial relay frame"
        if end_grant == "logout":
            assert (await admin.post("/v1/auth/logout")).status_code == 204
        elif end_grant == "revoke":
            monkeypatch.setattr(get_settings(), "fpl_cloud_control_admin_user_ids", "")
        else:
            monkeypatch.setattr(ingress.access, "clock", lambda: 10**12)
        closed = await asyncio.wait_for(outgoing.get(), 4)
        assert closed["type"] == "websocket.close"
        return closed["code"]
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
