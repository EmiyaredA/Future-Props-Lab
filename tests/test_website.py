"""Real browser sessions across separate trusted sockets, using isolated test data."""

from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from scripts.website.serve import authenticate_browser

from app.api import api_router
from app.console.governance.automation_access import automation_allowed
from app.console.governance.provisioning import create_account
from app.main import app as main_app
from app.runtime.db import SessionLocal
from app.runtime.remote_web import RemoteWeb
from app.runtime.website import WebsiteStaticFiles, WebsiteTransport

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
    (root / "index.html").write_text("<html>website</html>")
    application = FastAPI()
    application.exception_handlers.update(main_app.exception_handlers)
    application.include_router(api_router)
    application.state.database = main_app.state.database
    application.state.studio_http_auth = main_app.state.studio_http_auth
    application.state.studio_socket_auth = main_app.state.studio_socket_auth
    application.state.model_catalog_bindings = main_app.state.model_catalog_bindings
    application.state.account_creator = main_app.state.account_creator
    application.state.account_storage_check = main_app.state.account_storage_check
    application.state.automation_changes = {}
    public = RemoteWeb(
        origin="https://studio.example.test",
        port=28081,
        static=WebsiteStaticFiles(directory=root, html=True),
        authenticate=authenticate_browser,
    )

    class PublicIngress:
        def accepts(self, scope):
            return scope.get("server") == ("127.0.0.1", 28081)

        async def __call__(self, inner, scope, receive, send):
            await public(inner, scope, receive, send)

    application.mount("/", WebsiteStaticFiles(directory=root, html=True))
    application.add_middleware(
        WebsiteTransport,
        local_port=9000,
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
        yield SimpleNamespace(local=local, gateway=gateway, app=application, username=username)


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
    assert (await local.get("/v1/automation/runtime")).json() == {"local_browser": True}
    public = await public_client(website)
    try:
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
        for path in [
            "/v1/automation/access",
            "/v1/tool-navigation/codex-source",
            "/v1/tool-navigation/storage-usage",
            "/v1/agent-workbench/candidates",
        ]:
            response = await public.get(
                path, headers={"x-fpl-desktop-token": "forged", "x-forwarded-for": "127.0.0.1"}
            )
            assert response.status_code == 403, (path, response.text)
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
