"""Verify project discovery and approval against independent workshop services."""

from contextlib import AsyncExitStack
from types import SimpleNamespace

import httpx

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.assembly.independent.amadeus.application import (
    MIGRATIONS as AMADEUS_MIGRATIONS,
)
from studio.assembly.independent.amadeus.application import (
    create_app as amadeus_app,
)
from studio.assembly.independent.interview_assistant.application import (
    MIGRATIONS as INTERVIEW_MIGRATIONS,
)
from studio.assembly.independent.interview_assistant.application import (
    create_app as interview_app,
)
from studio.assembly.independent.motion_compositor.application import (
    MIGRATIONS as MOTION_MIGRATIONS,
)
from studio.assembly.independent.motion_compositor.application import (
    create_app as motion_app,
)
from studio.runtime.database.migrations import apply
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


async def test_amadeus_reads_two_workshops_and_applies_one_revision_bound_edit(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    services = {
        "amadeus": (amadeus_app, AMADEUS_MIGRATIONS),
        "interview": (interview_app, INTERVIEW_MIGRATIONS),
        "motion": (motion_app, MOTION_MIGRATIONS),
    }
    projects = "/v1/motion-compositor/projects"
    rooms = "/v1/interview-assistant/rooms"
    async with AsyncExitStack() as stack:
        asset_authorization = LiveAuthorization(
            service="assets", credential=ASSETS_SECRET, transport=case.mesh
        )
        case.assets.state.identity = asset_authorization
        stack.push_async_callback(asset_authorization.close)
        for service, (create_app, migrations) in services.items():
            root = tmp_path / service
            root.mkdir()
            apply(root / "service.db", service, migrations)
            credential = f"isolated-{service}-workshop-credential-" * 2
            case.identity.state.identity_options["service_credentials"][service] = credential
            options = {
                "motion": {"run_worker": False, "credential": credential},
                "amadeus": {"credential": credential},
            }
            app = create_app(
                state_root=root,
                catalog=CATALOG,
                public_key=case.key.public_key(),
                transport=case.mesh,
                **options.get(service, {}),
            )
            case.mesh.apps[service] = app
            await stack.enter_async_context(app.router.lifespan_context(app))
        client = await stack.enter_async_context(httpx.AsyncClient(transport=case.mesh))

        async def send(service, method, path, *, actor=case, **kwargs):
            return await client.request(
                method,
                f"http://{service}{path}",
                headers=await authorize(actor, service, method, path),
                **kwargs,
            )

        motion = await send("motion", "POST", projects, json={"title": "Intro effect"})
        assert motion.status_code == 200, motion.text
        room = await send(
            "interview",
            "POST",
            rooms,
            json={
                "request_id": "amadeus-workshop-room",
                "title": "Practice room",
            },
        )
        assert room.status_code == 201, room.text
        project_id, room_id = motion.json()["id"], room.json()["id"]

        async def read(operation, arguments=None, *, actor=case):
            return await send(
                "amadeus",
                "POST",
                "/v1/amadeus/operations/read",
                actor=actor,
                json={"operation": operation, "arguments": arguments or {}},
            )

        for operation, identity in (
            ("motion_compositor.list_projects", project_id),
            ("interview.list_interview_rooms", room_id),
        ):
            response = await read(operation)
            assert response.status_code == 200, response.text
            assert [item["id"] for item in response.json()["result"]["items"]] == [identity]

        other = await stack.enter_async_context(
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=case.identity),
                base_url=str(case.browser.base_url),
                headers=case.browser.headers,
            )
        )
        login = await other.post(
            "/v1/auth/login",
            json={
                "username": "source-owner",
                "password": PASSWORD,
            },
        )
        assert login.status_code == 200, login.text
        actor = SimpleNamespace(browser=other, csrf=other.cookies["fpl_csrf"])
        for operation, key, identity in (
            ("motion_compositor.get_project", "project_id", project_id),
            ("interview.get_interview_room", "room_id", room_id),
        ):
            args = {"path_params": {key: identity}}
            assert (await read(operation, args)).json()["result"]["id"] == identity
            assert (await read(operation, args, actor=actor)).status_code == 404

        conversation = await send("amadeus", "POST", "/v1/amadeus/conversations")
        actions = f"/v1/amadeus/conversations/{conversation.json()['id']}/actions"
        for request_id, expected_status in (
            ("effect-edit-first", "completed"),
            ("effect-edit-stale", "failed"),
        ):
            proposed = await send(
                "amadeus",
                "POST",
                actions,
                json={
                    "tool_name": "fpl_operation:motion_compositor.edit_document",
                    "arguments": {
                        "path_params": {"project_id": project_id},
                        "body": {
                            "expectedRevision": 0,
                            "requestId": request_id,
                            "operations": [
                                {"type": "updateSettings", "patch": {"backgroundColor": "#112233"}}
                            ],
                        },
                    },
                },
            )
            assert proposed.status_code == 200, proposed.text
            action = proposed.json()
            path = f"{actions}/{action['id']}"
            assert (await send("amadeus", "POST", path + "/execute")).status_code == 409
            approved = await send(
                "amadeus",
                "POST",
                path + "/decision",
                json={
                    "arguments_sha256": action["arguments_sha256"],
                    "approve": True,
                },
            )
            assert approved.status_code == 200, approved.text
            executed = await send("amadeus", "POST", path + "/execute")
            assert executed.json()["status"] == expected_status, executed.text
            assert (await send("amadeus", "POST", path + "/execute")).status_code == 409

        document = await send("motion", "GET", f"{projects}/{project_id}/document")
        assert document.json()["revision"] == 1
        assert document.json()["document"]["settings"]["backgroundColor"] == "#112233"
