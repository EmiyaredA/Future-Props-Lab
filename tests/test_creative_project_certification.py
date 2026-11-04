"""Independent project owners commit certification and audit the exact authorized result."""

import json
from contextlib import AsyncExitStack
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from tests.test_community_asset_protocol import (
    CATALOG,
    GATEWAY_SECRET,
    PASSWORD,
    scenario,  # noqa: F401
)

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from app.apps.visual_workshop.models import VisualWorkshopProject
from app.console.models.accounts import SecurityAuditEvent
from fpl_creative.application import create_app as creative_app
from fpl_creative.migrations.registry import MIGRATIONS as CREATIVE
from fpl_galgame.application import create_app as galgame_app
from fpl_galgame.migrations.registry import MIGRATIONS as GALGAME
from fpl_identity.accounts import create_account
from fpl_runtime.claims import HEADER
from fpl_runtime.migrations import apply
from fpl_runtime.project_certification import PREFIX, PROJECT_EVENT, CertificationCommand
from fpl_visual.application import create_app as visual_app
from fpl_visual.migrations.registry import MIGRATIONS as VISUAL

ORIGIN = "http://127.0.0.1:19000"
ADDRESS = "203.0.113.7"
CREDENTIALS = {
    service: "test-" + service + "-credential-" + "0" * 32
    for service in ("creative", "visual", "galgame")
}
PROJECTS = {
    "visual": (visual_app, VISUAL, VisualWorkshopProject, {"kind": "canvas"}),
    "galgame": (galgame_app, GALGAME, GalgameWorkshopProject, {}),
}


class LostAudit(httpx.AsyncBaseTransport):
    def __init__(self, mesh, kind, enabled):
        self.mesh, self.kind, self.enabled = mesh, kind, enabled
        self.lost = 0

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            self.enabled
            and request.url.host == "identity"
            and request.url.path == PREFIX + "/audit"
            and request.headers.get("authorization") == "Bearer " + CREDENTIALS[self.kind]
            and response.status_code == 200
        ):
            self.lost += 1
            await response.aclose()
            raise httpx.ReadError("audit acknowledgement lost", request=request)
        return response


async def authorize(browser, path, *, service="creative", method="PATCH"):
    return await browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": service,
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
            "Origin": ORIGIN,
            "X-CSRF-Token": browser.cookies["fpl_csrf"],
        },
    )


@pytest.mark.parametrize("kind", ["visual", "galgame"])
@pytest.mark.parametrize("lost", [False, True])
async def test_owner_scoped_certification_and_audit(scenario, tmp_path, kind, lost):  # noqa: F811
    case = scenario
    case.identity.state.identity_options["service_credentials"].update(CREDENTIALS)
    async with case.identity.state.database.sessions() as session:
        admin, _ = await create_account(
            session,
            username="certifier",
            display_name="Certifier",
            password=PASSWORD,
            platform_role="admin",
        )
        owner = admin.id
    transport = LostAudit(case.mesh, kind, lost)
    factory, migrations, model, attrs = PROJECTS[kind]
    for service, registry in ((kind, migrations), ("creative", CREATIVE)):
        (tmp_path / service).mkdir()
        apply(tmp_path / service / "service.db", service, registry)
    owner_options = {
        "state_root": tmp_path / kind,
        "catalog": CATALOG,
        "public_key": case.key.public_key(),
        "credential": CREDENTIALS[kind],
        "transport": transport,
        "run_worker": False,
    }
    target = factory(**owner_options)
    case.mesh.apps[kind] = target
    creative = creative_app(
        state_root=tmp_path / "creative",
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=CREDENTIALS["creative"],
        transport=transport,
    )
    body = {"is_official": True, "expected_revision": 0}
    path = f"/v1/account/project-certification/{kind}/owned"
    async with AsyncExitStack() as stack:
        for app in (target, creative):
            await stack.enter_async_context(app.router.lifespan_context(app))
        async with target.state.database.sessions(info={"owner_user_id": owner}) as session:
            session.add(model(id="owned", owner_user_id=owner, title="Owned project", **attrs))
            await session.commit()
        async with target.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            session.add(
                model(id="other", owner_user_id=case.owner, title="Unrelated project", **attrs)
            )
            await session.commit()
        async with target.state.database.sessions() as session:
            assert (await session.execute(text("PRAGMA foreign_key_check"))).all() == []
            tables = set(
                await session.scalars(text("SELECT name FROM sqlite_master WHERE type='table'"))
            )
            registry = json.loads(
                (
                    Path(__file__).resolve().parents[1] / "deploy/contracts/ownership.json"
                ).read_text()
            )
            assert tables == {"_fpl_service_schema"} | {
                item["table"] for item in registry["tables"] if item["service"] == kind
            }

        browser = await stack.enter_async_context(
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=case.identity),
                base_url=ORIGIN,
                headers={
                    "X-Fpl-Gateway": GATEWAY_SECRET,
                    "X-Fpl-Ingress": "local",
                    "X-Fpl-Client-Ip": ADDRESS,
                },
            )
        )
        login = await browser.post(
            "/v1/auth/login", json={"username": "certifier", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        assert (await authorize(case.browser, path)).status_code == 403
        http = await stack.enter_async_context(
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=creative), base_url="http://creative"
            )
        )

        async def patch(uri, payload):
            token = await authorize(browser, uri)
            assert token.status_code == 204, token.text
            return await http.patch(uri, headers={HEADER: token.headers[HEADER]}, json=payload)

        wrong_owner = await patch(path.replace("owned", "other"), body)
        assert wrong_owner.status_code == 404, wrong_owner.text
        assert wrong_owner.json()["code"] == "project_not_found"
        result = await patch(path, body)
        assert result.status_code == (503 if lost else 200), result.text
        if lost:
            assert transport.lost == 2
        else:
            assert result.json() == {"id": "owned", "is_official": True, "revision": 1}
        conflict = await patch(path, body)
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["current"]["revision"] == 1
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=target), base_url=f"http://{kind}"
        ) as owner_http:
            prefix = f"/v1/{kind}-workshop/projects"
            for uri in (f"{prefix}/owned", prefix):
                token = await authorize(browser, uri, service=kind, method="GET")
                assert token.status_code == 204, token.text
                public = await owner_http.get(uri, headers={HEADER: token.headers[HEADER]})
                assert public.status_code == 200, public.text
                record = public.json()
                if uri == prefix:
                    assert [item["id"] for item in record["items"]] == ["owned"]
                    record = record["items"][0]
                assert record["is_official"] is True and record["revision"] == 1
        async with target.state.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(model, "owned")
            assert row.is_official and row.revision == 1
            receipt_model = target.state.project_certifications.receipts
            receipt = (await session.scalars(select(receipt_model))).one()
            assert (receipt.authority is not None) == lost
            request_id = receipt.id

        # A browser authorization revoked after issuance cannot apply another update.
        if not lost:
            command = CertificationCommand(
                kind=kind,
                project_id="owned",
                request_id=uuid4(),
                expected_revision=1,
                is_official=False,
            )
            original = await authorize(browser, path)
            private = await stack.enter_async_context(httpx.AsyncClient(transport=case.mesh))
            allowed = await private.post(
                "http://identity" + PREFIX + "/authorize",
                headers={"Authorization": "Bearer " + CREDENTIALS["creative"]},
                json={
                    "assertion": original.headers[HEADER],
                    "command": command.model_dump(mode="json"),
                },
            )
            assert allowed.status_code == 200, allowed.text
            token = allowed.json()["authority"]
            false_audit = await private.post(
                "http://identity" + PREFIX + "/audit",
                headers={"Authorization": "Bearer " + CREDENTIALS[kind]},
                json={
                    "authority": token,
                    "result": {"id": "owned", "is_official": True, "revision": 2},
                },
            )
            assert false_audit.status_code == 409, false_audit.text
            revoked = await browser.post(
                "/v1/auth/logout",
                headers={"Origin": ORIGIN, "X-CSRF-Token": browser.cookies["fpl_csrf"]},
            )
            assert revoked.status_code == 204, revoked.text
            blocked = await private.post(
                f"http://{kind}" + PREFIX + "/apply", headers={"Authorization": "Bearer " + token}
            )
            assert blocked.status_code == 401, blocked.text

    transport.enabled = False
    restarted = factory(**owner_options)
    async with restarted.router.lifespan_context(restarted):
        await restarted.state.project_certifications.process_once()
        async with restarted.state.database.sessions(info={"owner_user_id": owner}) as session:
            receipt = await session.get(receipt_model, (owner, request_id))
            assert receipt.audit_event_id and receipt.authority is None
            assert (await session.get(model, "owned")).revision == 1
    async with case.identity.state.database.sessions() as session:
        event = (
            await session.scalars(
                select(SecurityAuditEvent).where(SecurityAuditEvent.event_type == PROJECT_EVENT)
            )
        ).one()
        assert event.actor_user_id == event.owner_user_id == owner
        assert event.client_ip == ADDRESS
        assert event.metadata_json == {"status_to": "official"}


async def test_certification_authority_rejects_a_different_project_and_an_unsigned_outcome(
    scenario,  # noqa: F811
):
    case = scenario
    case.identity.state.identity_options["service_credentials"].update(CREDENTIALS)
    grant = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "creative",
            "X-Fpl-Request-Method": "GET",
            "X-Fpl-Request-Uri": "/v1/creative-workshop/items",
        },
    )
    assert grant.status_code == 204, grant.text
    command = CertificationCommand(
        kind="visual",
        project_id="other",
        request_id=uuid4(),
        expected_revision=0,
        is_official=True,
    )
    async with httpx.AsyncClient(transport=case.mesh) as client:
        result = await client.post(
            "http://identity" + PREFIX + "/authorize",
            headers={"Authorization": "Bearer " + CREDENTIALS["creative"]},
            json={"assertion": grant.headers[HEADER], "command": command.model_dump(mode="json")},
        )
        assert result.status_code == 401, result.text
        result = await client.post(
            "http://identity" + PREFIX + "/audit",
            headers={"Authorization": "Bearer " + CREDENTIALS["visual"]},
            json={
                "authority": "unsigned",
                "result": {"id": "other", "is_official": True, "revision": 1},
            },
        )
        assert result.status_code == 401, result.text
