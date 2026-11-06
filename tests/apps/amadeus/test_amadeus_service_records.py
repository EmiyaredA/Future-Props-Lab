"""Exercise independently owned Amadeus history and restart without Identity tables."""

import asyncio
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusRun,
)
from studio.assembly.independent.amadeus.application import create_app
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.runtime.database.migrations import apply
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

SOURCE = "/v1/amadeus/conversations"


async def test_amadeus_record_contracts_ownership_and_recovery(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    apply(tmp_path / "service.db", "amadeus", MIGRATIONS)

    def application():
        return create_app(
            state_root=tmp_path,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential="isolated-amadeus-service-credential-" * 2,
        )

    app = application()
    published = json.loads(
        (Path(__file__).resolve().parents[3] / "web/src/generated/openapi.json").read_text()
    )["paths"]
    for path, methods in app.openapi()["paths"].items():
        if path.startswith("/v1/"):
            for method, operation in methods.items():
                assert operation == published[path][method]
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        assert (await api.get(SOURCE)).status_code == 401

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        created = await send("POST", SOURCE)
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        path = SOURCE + "/" + identity
        saved = await send("PATCH", path, json={"expected_revision": 0, "title": "Owned history"})
        assert saved.status_code == 200, saved.text
        stale = await send("PATCH", path, json={"expected_revision": 0, "title": "Stale"})
        assert stale.status_code == 409
        headers = await authorize(case, "amadeus", "GET", path)
        actor = verify_context(
            headers[HEADER],
            service="amadeus",
            method="GET",
            path=path,
            public_key=case.key.public_key(),
        )
        other = issue_context(
            replace(actor, user_id=case.owner),
            service="amadeus",
            method="GET",
            path=path,
            private_key=case.key,
            key_id="fixture",
        )
        assert (await api.get(path, headers={HEADER: other})).status_code == 404
        run_id = str(uuid4())
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            db.add(
                AmadeusRun(
                    id=run_id,
                    conversation_id=identity,
                    owner_user_id=case.viewer,
                    user_id=case.viewer,
                    agent_id="codex",
                    model_id="code-agent",
                    status="running",
                    active_owner_key=case.viewer + ":" + case.viewer,
                    partial_text="Saved partial",
                )
            )
            await db.flush()
            db.add(
                AmadeusAction(
                    conversation_id=identity,
                    owner_user_id=case.viewer,
                    user_id=case.viewer,
                    tool_name="write_work_file",
                    arguments_json={},
                    arguments_sha256="0" * 64,
                    status="running",
                    run_id=run_id,
                )
            )
            await db.commit()
        assert (await send("GET", path + "/runs/" + run_id)).json()["run"]["status"] == "running"

    restarted = application()
    async with restarted.router.lifespan_context(restarted):
        async with restarted.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            run = await db.get(AmadeusRun, run_id)
            assert run.status == "interrupted" and run.active_owner_key is None
            message = await db.scalar(select(AmadeusMessage))
            action = await db.scalar(select(AmadeusAction))
            assert message.content == "Saved partial" and action.status == "unknown"
            assert (await db.get(AmadeusConversation, identity)).title == "Owned history"

        folder = tmp_path / "accounts" / case.viewer / "amadeus" / identity
        folder.mkdir(parents=True)
        (folder / "output.txt").write_text("isolated owned work file")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://amadeus"
        ) as api:
            deleted = await api.delete(
                path,
                params={"expected_revision": saved.json()["revision"]},
                headers=await authorize(case, "amadeus", "DELETE", path),
            )
            assert deleted.status_code == 200, deleted.text
        assert not folder.exists()


async def test_amadeus_import_stream_and_file_cas(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    apply(tmp_path / "service.db", "amadeus", MIGRATIONS)
    app = create_app(
        state_root=tmp_path,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential="isolated-amadeus-service-credential-" * 2,
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        created = await send("POST", SOURCE)
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        root = f"{SOURCE}/{identity}"
        contents = b"x" * (9 * 1024 * 1024)
        upload = {"upload": ("original.bin", contents, "application/octet-stream")}
        reply = await send("POST", root + "/imports", files=upload)
        assert reply.status_code == 200, reply.text
        digest = hashlib.sha256(contents).hexdigest()
        assert reply.json()["sha256"] == digest
        original = await send("GET", root + "/files/imports/original.bin")
        assert original.status_code == 200 and original.content == contents
        assert original.headers["Content-Length"] == str(len(contents))
        assert (await send("POST", root + "/imports", files=upload)).status_code == 409

        path = root + "/files/outputs/response.txt"
        first = await send("PUT", path, json={"content": "Original"})
        assert first.status_code == 200, first.text
        headers = await authorize(case, "amadeus", "PUT", path)
        replies = await asyncio.gather(
            *(
                api.put(
                    path,
                    headers=headers,
                    json={
                        "content": text,
                        "expected_sha256": first.json()["sha256"],
                    },
                )
                for text in ("A", "B")
            )
        )
        assert sorted(result.status_code for result in replies) == [200, 409]
        files = await send("GET", root + "/files")
        assert len(files.json()["items"]) == 2

        monkeypatch.setattr("studio.apps.amadeus.request_limits.MAX_MULTIPART_BYTES", 1024)
        over = await send(
            "POST",
            root + "/imports",
            files={"upload": ("oversize.bin", b"x" * 2048, "application/octet-stream")},
        )
        assert over.status_code == 413
        assert (await send("GET", root + "/files/imports/oversize.bin")).status_code == 404
        assert not list((tmp_path / "accounts").rglob(".amadeus-*.tmp"))


async def test_amadeus_delegates_only_registered_reads_to_live_owned_routes(
    scenario,  # noqa: F811
    tmp_path,
):
    from studio.contracts.identity.delegation import RequestGrant, permitted

    case = scenario
    state = tmp_path / "amadeus"
    state.mkdir()
    apply(state / "service.db", "amadeus", MIGRATIONS)
    credential = "isolated-amadeus-service-credential-" * 2
    case.identity.state.identity_options["service_credentials"]["amadeus"] = credential
    app = create_app(
        state_root=state,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credential,
        transport=case.mesh,
    )
    catalog_path = "/v1/amadeus/operations"
    source = catalog_path + "/read"
    grant = RequestGrant(
        "amadeus", "amadeus.operation.read", "POST", source, "assets", "GET", "/v1/files"
    )
    assert permitted(grant, CATALOG)
    for change in (
        {"target_method": "POST"},
        {"target_path": "/v1/amadeus/conversations", "target_service": "amadeus"},
        {"source_path": "/v1/amadeus/model-turn"},
    ):
        assert not permitted(replace(grant, **change), CATALOG)

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        catalog = await api.get(
            catalog_path,
            params={"resource": "files"},
            headers=await authorize(case, "amadeus", "GET", catalog_path),
        )
        assert catalog.status_code == 200, catalog.text
        operations = {entry["id"]: entry for entry in catalog.json()["items"]}
        assert operations["files.list_files"]["path"] == "/v1/files"
        assert all(entry["resource"] == "files" for entry in operations.values())
        write = next(entry["id"] for entry in operations.values() if entry["method"] == "POST")
        proof = await authorize(case, "amadeus", "POST", source)

        async def read(operation, arguments=None):
            return await api.post(
                source, headers=proof, json={"operation": operation, "arguments": arguments or {}}
            )

        assert (await read(write)).status_code == 422
        assert (await read("https://other-host.invalid/path")).status_code == 422
        assert (await read("files.list_files", {"body": {}})).status_code == 422
        valid = await read("files.list_files")
        assert valid.status_code == 200, valid.text
        assert case.asset not in valid.text

        logout = await case.browser.post(
            "/v1/auth/logout",
            headers={"X-CSRF-Token": case.csrf, "Origin": "http://127.0.0.1:19000"},
        )
        assert logout.status_code == 204
        assert (await read("files.list_files")).status_code == 401
