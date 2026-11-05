"""One-shot action approval and outcomes in the independent service."""

import asyncio

import httpx
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.amadeus.application import create_app
from studio.runtime.database.migrations import apply


async def test_action_stream_claim_and_write_share_the_same_approval(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "amadeus"
    root.mkdir()
    apply(root / "service.db", "amadeus", MIGRATIONS)
    credential = "isolated-amadeus-action-token-" * 2
    case.identity.state.identity_options["service_credentials"]["amadeus"] = credential
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credential,
        transport=case.mesh,
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        path = "/v1/amadeus/conversations"
        created = await send("POST", path)
        assert created.status_code == 200, created.text
        path += "/" + created.json()["id"]
        proposal = await send(
            "POST",
            path + "/actions",
            json={
                "tool_name": "write_work_file",
                "arguments": {"name": "owned.txt", "content": "Approved content"},
            },
        )
        assert proposal.status_code == 200, proposal.text
        record = proposal.json()
        action = f"{path}/actions/{record['id']}"
        execute = action + "/execute"
        assert (await send("POST", execute)).status_code == 409
        assert (
            await send(
                "POST", action + "/decision", json={"arguments_sha256": "0" * 64, "approve": True}
            )
        ).status_code == 409
        approved = await send(
            "POST",
            action + "/decision",
            json={"arguments_sha256": record["arguments_sha256"], "approve": True},
        )
        assert approved.status_code == 200, approved.text
        first, second = await asyncio.gather(
            send("POST", execute), send("POST", execute + "/stream")
        )
        assert second.headers["Content-Type"].startswith("application/x-ndjson")
        if first.status_code == 200:
            assert first.json()["status"] == "completed"
            assert second.json()["code"] == "approval_conflict"
        else:
            assert first.status_code == 409
            assert second.json()["type"] == "end"
            assert second.json()["action"]["status"] == "completed"
        file = await send("GET", path + "/files/outputs/owned.txt")
        assert file.content == b"Approved content"
        assert (await send("POST", action + "/cancel")).status_code == 409


class ActionMesh(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.mode = "normal"
        self.requests = 0

    async def handle_async_request(self, request):
        if request.url.host != "assets" or request.method != "POST":
            return await self.mesh.handle_async_request(request)
        self.requests += 1
        if self.mode == "tamper-body":
            headers = {
                key: value for key, value in request.headers.items() if key != "content-length"
            }
            request = httpx.Request(
                "POST", request.url, headers=headers, json={"scope": "library", "name": "Forged"}
            )
        if self.mode == "tamper-query":
            request.url = request.url.copy_merge_params({"unexpected": "tampered"})
        response = await self.mesh.handle_async_request(request)
        if self.mode == "lost":
            assert response.status_code == 200
            await response.aclose()
            raise httpx.ReadError("isolated lost approved-operation response", request=request)
        return response


async def test_approved_operation_binds_exact_bytes_and_does_not_retry_uncertain_writes(
    scenario,  # noqa: F811
    tmp_path,
):
    from studio.contracts.identity.approved_operations import PURPOSE, request_digest
    from studio.contracts.identity.delegation import RequestGrant, permitted

    case = scenario
    root = tmp_path / "amadeus"
    root.mkdir()
    apply(root / "service.db", "amadeus", MIGRATIONS)
    credential = "isolated-approved-operation-token-" * 2
    case.identity.state.identity_options["service_credentials"]["amadeus"] = credential
    mesh = ActionMesh(case.mesh)
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credential,
        transport=mesh,
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        conversations = "/v1/amadeus/conversations"
        path = conversations + "/" + (await send("POST", conversations)).json()["id"]
        for mode in ("normal", "tamper-body", "tamper-query", "lost"):
            proposed = await send(
                "POST",
                path + "/actions",
                json={
                    "tool_name": "fpl_operation:files.create_file_folder",
                    "arguments": {"body": {"scope": "library", "name": mode}},
                },
            )
            assert proposed.status_code == 200, proposed.text
            record = proposed.json()
            action = f"{path}/actions/{record['id']}"
            ready = await send(
                "POST",
                action + "/decision",
                json={"arguments_sha256": record["arguments_sha256"], "approve": True},
            )
            assert ready.status_code == 200, ready.text
            execute = action + "/execute"
            grant = RequestGrant(
                "amadeus",
                PURPOSE,
                "POST",
                execute,
                "assets",
                "POST",
                "/v1/file-folders",
                request_digest(b"", b"{}"),
            )
            assert permitted(grant, CATALOG)
            assert not permitted(
                RequestGrant(
                    "amadeus", PURPOSE, "POST", execute, "assets", "POST", "/v1/file-folders"
                ),
                CATALOG,
            )
            mesh.mode = mode
            result = await send("POST", execute)
            assert result.status_code == 200, result.text
            if mode == "normal":
                assert result.json()["status"] == "completed", result.text
                assert result.json()["result"]["result"]["name"] == mode
            elif mode == "lost":
                assert result.json()["status"] == "unknown", result.text
            else:
                assert result.json()["status"] == "failed", result.text
                assert result.json()["result"]["code"] == "request_digest_mismatch"
            assert (await send("POST", execute)).status_code == 409
        assert mesh.requests == 4
        async with httpx.AsyncClient(transport=case.mesh, base_url="http://assets") as assets:
            path = "/v1/file-folders"
            listed = await assets.get(
                path,
                params={"scope": "library"},
                headers=await authorize(case, "assets", "GET", path),
            )
        assert listed.status_code == 200, listed.text
        assert {item["name"] for item in listed.json()["items"]} == {"normal", "lost"}
