"""Real browser sessions across separate trusted sockets, using isolated test data."""

import json
import os
import time
from functools import partial
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from scripts.website import frontend
from scripts.website.serve import authenticate_browser

from studio.assembly.website.account_provisioning import create_account
from studio.assembly.website.application import create_app
from studio.contracts.gateway.automation_policy import automation_allowed
from studio.runtime.http.remote_web import RemoteWeb
from studio.runtime.http.website import CurrentWebsite, WebsiteTransport, pin_release
from studio.runtime.http.website_releases import RETIRED_SECONDS
from website_test_support import SessionLocal
from website_test_support import app as main_app

pytestmark = pytest.mark.real_auth


@pytest.fixture
async def website(tmp_path):
    username = "site-" + uuid4().hex[:12]
    async with SessionLocal() as session:
        _, password = await create_account(
            session, username=username, display_name="Site", is_platform_admin=True
        )
    root = tmp_path / "web"
    root.mkdir()
    (root / "index.html").write_text("<html><head></head>website</html>")
    (root / "build.json").write_text('{"build_id":"first"}')
    current = tmp_path / "current"
    current.symlink_to(root, target_is_directory=True)
    static = CurrentWebsite(current)
    application = create_app(main_app.state.settings, database=main_app.state.database)
    application.state.automation_changes = {}
    public = RemoteWeb(
        origin="https://studio.example.test",
        port=28081,
        static=static,
        authenticate=partial(authenticate_browser, sessions=SessionLocal),
    )

    class PublicIngress:
        def accepts(self, scope):
            return scope.get("server") == ("127.0.0.1", 28081)

        async def __call__(self, inner, scope, receive, send):
            await public(inner, scope, receive, send)

    application.mount("/", static)
    application.add_middleware(
        WebsiteTransport,
        local_port=9000,
        frontend_port=3000,
        public_access=PublicIngress(),
        automation_policy=automation_allowed,
    )
    gateway = application
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway),
        base_url="http://127.0.0.1:9000",
        headers={"Origin": "http://127.0.0.1:9000"},
    ) as local:
        response = await local.post(
            "/v1/auth/login", json={"username": username, "password": password}
        )
        assert response.status_code == 200, response.text
        local.headers["X-CSRF-Token"] = local.cookies["fpl_csrf"]
        response = await local.post(
            "/v1/auth/change-password",
            json={"current_password": password, "new_password": "Site-test-password-5801!"},
        )
        assert response.status_code == 204, response.text
        local.headers["X-CSRF-Token"] = local.cookies["fpl_csrf"]
        yield SimpleNamespace(
            local=local, gateway=gateway, app=application, username=username, current=current
        )


async def test_same_build_switches_on_both_ingresses_without_restart(website):
    transport = httpx.ASGITransport(app=website.gateway)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:3000") as local,
        httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:28081",
            headers={"Host": "studio.example.test"},
        ) as public,
    ):
        for client in (local, public):
            assert (await client.get("/build.json")).json()["build_id"] == "first"
        root = website.current.parent / "second"
        root.mkdir()
        (root / "index.html").write_text("<html><head></head>new page</html>")
        (root / "build.json").write_text('{"build_id":"second"}')
        link = root.parent / "next"
        link.symlink_to(root, target_is_directory=True)
        link.replace(website.current)
        for client in (local, public):
            assert (await client.get("/build.json")).json()["build_id"] == "second"
            page = await client.get("/management/audit", headers={"Accept": "text/html"})
            assert page.headers["Cache-Control"] == "no-cache"
            assert 'name="fpl-build" content="second"' in page.text


async def test_old_hashes_resolve_only_while_release_is_retained(website, monkeypatch):
    current = website.current
    monkeypatch.setattr(frontend, "CURRENT", current.relative_to(current.parent))
    retired = current.parent / "retired"
    retired.mkdir()

    def publish(digit):
        identity = digit * 64
        release = current.parent / "builds" / identity
        asset = f"assets/chunk-{digit * 8}.js"
        (release / "assets").mkdir(parents=True)
        (release / asset).write_text(digit)
        if digit == "a":
            (release / "assets/unlisted-12345678.js").touch()
        (release / "index.html").write_text(f'<head></head><script src="/{asset}"></script>')
        (release / "build.json").write_text(json.dumps({"build_id": identity}))
        (release / "manifest.json").write_text(
            json.dumps({"build_id": identity, "files": [{"path": asset}]})
        )
        previous = current.resolve()
        if previous.parent == release.parent:
            (retired / previous.name).touch()
        link = current.with_name("next")
        link.symlink_to(release)
        link.replace(current)
        return release, "/" + asset

    first, old_asset = publish("a")
    transport = httpx.ASGITransport(app=website.gateway)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:3000") as local,
        httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:28081",
            headers={"Host": "studio.example.test"},
        ) as public,
    ):
        for client in (local, public):
            assert old_asset in (await client.get("/")).text
        second, second_asset = publish("b")
        for client in (local, public):
            assert (await client.get(old_asset)).text == "a"
            assert second_asset in (await client.get("/")).text
            assert (await client.get("/assets/unlisted-12345678.js")).status_code == 404
            assert (await client.get("/assets/%2e%2e" + old_asset)).status_code == 404
        publish("c")
        publish("d")
        with pin_release(first):
            assert (await local.get(old_asset)).status_code == 404
            frontend.prune(current.parent)
            assert first.is_dir()
        past = time.time() - RETIRED_SECONDS - 1
        os.utime(retired / second.name, (past, past))
        assert (await public.get(second_asset)).status_code == 404
        frontend.prune(current.parent)
        assert not first.exists()
        assert not second.exists()


async def public_client(site):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=site.gateway),
        base_url="http://127.0.0.1:28081",
        headers={"Host": "studio.example.test", "Origin": "https://studio.example.test"},
    )
    response = await client.post(
        "/v1/auth/login", json={"username": site.username, "password": "Site-test-password-5801!"}
    )
    assert response.status_code == 200, response.text
    cookies = response.headers.get_list("set-cookie")
    assert all("; Secure" in value for value in cookies)
    client.headers["Cookie"] = "; ".join(value.split(";", 1)[0] for value in cookies)
    client.headers["X-CSRF-Token"] = client.cookies["fpl_csrf"]
    return client


async def test_site_shares_accounts_and_projects_without_native_transport(website):
    local = website.local
    assert (await local.get("/v1/auth/me")).headers["X-Fpl-Invite-Registration"] == "allowed"
    assert (await local.get("/v1/automation/runtime")).json() == {"local_browser": True}
    public = await public_client(website)
    try:
        assert "X-Fpl-Invite-Registration" not in (await public.get("/v1/auth/me")).headers
        assert (await public.post("/v1/auth/register", json={})).status_code == 404
        assert (await public.get("/v1/automation/runtime")).json() == {"local_browser": False}
        project = await local.post(
            "/v1/visual-workshop/projects", json={"title": "Original account", "kind": "image"}
        )
        assert project.status_code == 200, project.text
        result = await public.get(f"/v1/visual-workshop/projects/{project.json()['id']}")
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        link = await local.post(
            "/v1/automation/open", json={"kind": "visual", "resource_id": project.json()["id"]}
        )
        assert link.status_code == 200
        assert link.json()["path"].endswith(project.json()["id"] + "/canvas")
        assert (await local.get("/v1/amadeus/conversations")).status_code == 200

    finally:
        await public.aclose()


async def test_public_admin_cannot_manage_host_or_public_access_even_with_spoofed_headers(website):
    public = await public_client(website)
    try:
        for path, expected in [
            ("/v1/automation/access", 403),
            ("/v1/tool-navigation/codex-source", 404),
            ("/v1/tool-navigation/storage-usage", 404),
            ("/v1/agent-workbench/candidates", 404),
        ]:
            response = await public.get(
                path, headers={"x-fpl-desktop-token": "forged", "x-forwarded-for": "127.0.0.1"}
            )
            assert response.status_code == expected, (path, response.text)
        status = await public.get("/v1/cloud-control/status")
        assert status.status_code == 200 and not status.json()["enabled"]
        assert (
            await public.post("/v1/automation/access/actions", json={"action": "public_start"})
        ).status_code == 403
        assert (
            await public.get("/v1/automation/runtime", headers={"Host": "127.0.0.1:28081"})
        ).status_code == 403

    finally:
        await public.aclose()


async def test_unknown_api_assets_and_removed_native_routes_never_become_html(website):
    for path in ["/v1/unknown", "/v1/desktop/setup", "/assets/missing.js"]:
        assert (await website.local.get(path, headers={"Accept": "text/html"})).status_code == 404
    assert (
        await website.local.get("/apps/visual-workshop/project", headers={"Accept": "text/html"})
    ).status_code == 200
    assert (await website.local.get("/", headers={"Host": "evil.invalid"})).status_code == 403
    assert (
        await website.local.post(
            "/v1/automation/open",
            headers={"X-CSRF-Token": "wrong"},
            json={"kind": "visual", "resource_id": "missing"},
        )
    ).status_code == 403
    assert (
        await website.local.post(
            "/v1/automation/open", json={"kind": "visual", "resource_id": "missing"}
        )
    ).status_code == 404
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=website.gateway),
        base_url="http://127.0.0.1:28081",
        headers={"Host": "studio.example.test", "Accept": "text/html"},
    ) as public:
        assert (await public.get("/v1/unknown")).status_code == 404
        assert (await public.get("/assets/missing.js")).status_code == 404


@pytest.mark.parametrize("port", [9000, 28081])
async def test_api_key_automation_keeps_allowlist_and_reports_account_scoped_changes(website, port):
    created = await website.local.post(
        "/v1/account/api-keys",
        json={
            "name": "website-test",
            "scopes": ["studio:read", "studio:write"],
            "expires_in_days": 1,
        },
    )
    assert created.status_code == 201, created.text
    secret = created.json()["secret"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=website.gateway),
        base_url=f"http://127.0.0.1:{port}",
        headers={
            "Authorization": f"Bearer {secret}",
            **({"Host": "studio.example.test"} if port == 28081 else {}),
        },
    ) as client:
        catalog = await client.get("/v1/automation/capabilities")
        assert catalog.status_code == 200
        assert "visual.create_project" in catalog.json()["operations"]
        assert not any(key.startswith("admin.") for key in catalog.json()["operations"])
        before = (await website.local.get("/v1/automation/changes")).json()["revision"]
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "SDK-created", "kind": "image"}
        )
        assert project.status_code == 200
        assert (await website.local.get("/v1/automation/changes")).json()["revision"] == before + 1
        assert (await client.get("/v1/automation/access")).status_code == 403
        assert (await client.get("/v1/platform/accounts")).status_code == 403
        assert (await client.get("/v1/amadeus/conversations")).status_code == 403


async def test_hot_frontend_proxy_keeps_session_csrf_and_socket_permissions(website, monkeypatch):
    from studio.config.settings import get_settings

    monkeypatch.setattr(get_settings(), "cors_origins", "http://127.0.0.1:3000")
    app = create_app(main_app.state.settings, database=main_app.state.database)
    app.state.automation_changes = {}
    app.add_middleware(WebsiteTransport, local_port=9001, frontend_origin="http://127.0.0.1:3000")
    # Vite rewrites Host to the API target and preserves the browser's Origin.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://127.0.0.1:9001",
        cookies=website.local.cookies,
        headers={
            "Origin": "http://127.0.0.1:3000",
            "X-CSRF-Token": website.local.cookies["fpl_csrf"],
        },
    ) as client:
        result = await client.get("/v1/automation/runtime")
        assert result.status_code == 200, result.text
        assert result.json() == {"local_browser": True}
        result = await client.post(
            "/v1/automation/open", json={"kind": "visual", "resource_id": "missing"}
        )
        assert result.status_code == 404, result.text
        assert (
            await client.post(
                "/v1/automation/open",
                json={"kind": "visual", "resource_id": "missing"},
                headers={"X-CSRF-Token": "wrong"},
            )
        ).status_code == 403
        for headers in [
            {"Origin": "http://evil.invalid"},
            {"Host": "127.0.0.1:3000"},
            {"Host": "evil.invalid", "X-Forwarded-Host": "127.0.0.1:9001"},
        ]:
            assert (await client.get("/v1/automation/runtime", headers=headers)).status_code == 403
    public = await public_client(website)
    try:
        result = await public.get(
            "/v1/automation/runtime", headers={"Origin": "http://127.0.0.1:3000"}
        )
        assert result.status_code == 200
        assert result.json() == {"local_browser": False}
        assert (
            await public.post(
                "/v1/automation/access/actions",
                json={"action": "public_start"},
                headers={"Origin": "http://127.0.0.1:3000"},
            )
        ).status_code == 403
    finally:
        await public.aclose()
