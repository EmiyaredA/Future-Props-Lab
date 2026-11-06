import base64
import hashlib
from contextlib import aclosing
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest

from studio.apps.identity.use_cases.happier_oidc import BROWSER_COOKIE, CLIENT_ID
from studio.assembly.website.happier import Happier
from studio.config.settings import get_settings
from tests.apps.remote_desktop.test_cloud_control import CLOUD, admin_client, configure, unlock
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


class RelayPage(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"Happier"


async def test_happier_exchange_and_oidc_use_real_fpl_session(monkeypatch):
    admin, owner = await admin_client(local=False)
    other, other_id = await admin_client(local=False)
    configure(monkeypatch, owner, other_id)
    settings = get_settings().model_copy(
        update={
            "fpl_remote_web_origin": "https://test",
            "fpl_happier_origin": "https://happier.test",
            "fpl_happier_admin_user_id": owner,
            "fpl_happier_oidc_client_secret": "test-client-secret-00000000000000",
        }
    )
    happier = Happier(settings, SessionLocal, read_cloud_settings=get_settings)
    monkeypatch.setattr(app.state, "happier", happier)
    ingress = happier.ingress()

    async def upstream(request):
        assert BROWSER_COOKIE not in request.headers.get("cookie", "")
        return httpx.Response(200, stream=RelayPage(), headers={"Content-Type": "text/html"})

    await ingress.client.aclose()
    ingress.client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    async with (
        aclosing(admin),
        aclosing(other),
        ingress.client,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(ingress), base_url=happier.identity.origin
        ) as browser,
    ):
        launch = CLOUD + "/happier/launch"
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

        discovery = (
            await browser.get(happier.identity.issuer + "/.well-known/openid-configuration")
        ).json()
        verifier = "p" * 64
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        authorize = {
            "client_id": CLIENT_ID,
            "response_type": "code",
            "scope": "openid",
            "redirect_uri": happier.identity.callback,
            "state": "s" * 550,
            "nonce": "test-nonce",
            "code_challenge_method": "S256",
            "code_challenge": challenge.rstrip(b"=").decode(),
        }
        invalid = await browser.get(
            discovery["authorization_endpoint"],
            params={**authorize, "redirect_uri": "https://evil.test"},
        )
        assert invalid.status_code == 400
        callback = await browser.get(discovery["authorization_endpoint"], params=authorize)
        assert callback.status_code == 302
        query = parse_qs(urlsplit(callback.headers["location"]).query)
        assert query["state"] == [authorize["state"]]
        token_data = {
            "grant_type": "authorization_code",
            "redirect_uri": happier.identity.callback,
            "code": query["code"][0],
            "code_verifier": verifier,
        }
        token = discovery["token_endpoint"]
        assert (await browser.post(token, data=token_data)).status_code == 401
        auth = (CLIENT_ID, settings.fpl_happier_oidc_client_secret)
        result = await browser.post(token, data=token_data, auth=auth)
        assert result.status_code == 200, result.text
        jwks = (await browser.get(discovery["jwks_uri"])).json()
        claims = jwt.decode(
            result.json()["id_token"],
            jwt.PyJWK.from_dict(jwks["keys"][0]),
            algorithms=["RS256"],
            audience=CLIENT_ID,
            issuer=happier.identity.issuer,
        )
        assert claims["sub"] == owner and claims["nonce"] == "test-nonce"
        assert (await browser.post(token, data=token_data, auth=auth)).status_code == 400
        with monkeypatch.context() as policy:
            policy.setattr(get_settings(), "fpl_cloud_control_admin_user_ids", "")
            assert (await browser.get("/")).status_code == 403
        with monkeypatch.context() as time:
            time.setattr(happier.identity, "clock", lambda: claims["exp"] + 3600)
            assert (await browser.get("/")).status_code == 403
        assert (await admin.post("/v1/auth/logout")).status_code == 204
        assert (await browser.get("/")).status_code == 403
        assert (
            await browser.get(discovery["authorization_endpoint"], params=authorize)
        ).status_code == 403
