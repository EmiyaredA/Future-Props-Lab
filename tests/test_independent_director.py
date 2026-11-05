"""Director runs the published API and content-addressed files in its own state."""

import asyncio
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from studio.apps.director_desk.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.director_desk.application import create_app
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
BASE = "/v1/director-desk"
PROJECTS = f"{BASE}/projects"


async def test_director_isolated_api_files_and_editor_recovery(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "director"
    apply(state / "service.db", "director", MIGRATIONS)

    schema_path = ROOT / "web/src/generated/openapi.json"

    def application(web_root=None):
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            schema_path=schema_path,
            web_root=web_root,
        )

    app = application()

    async def call(api, method, path, **kwargs):
        headers = await authorize(case, "director", method, path)
        return await api.request(method, path, headers=headers, **kwargs)

    def client(app):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://director")

    async with app.router.lifespan_context(app), client(app) as api:
        assert (await api.get(PROJECTS)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        created = await call(api, "POST", PROJECTS, json={"title": "独立预演"})
        assert created.status_code == 201
        project = created.json()["id"]
        item = f"{PROJECTS}/{project}"
        body = b"synthetic Director scene file"
        digest = hashlib.sha256(body).hexdigest()
        upload = await call(api, "POST", f"{item}/files", files={"upload": ("scene.bin", body)})
        assert upload.json() == {"key": digest, "size": len(body)}
        assert (await call(api, "GET", f"{item}/files/{digest}")).content == body
        document = {
            **created.json()["document"],
            "resources": [{"package": {"files": [{"path": "scene.bin", "file": digest}]}}],
        }
        patched = await call(
            api,
            "PATCH",
            item,
            json={"title": "独立预演", "document": document, "expected_revision": 0},
        )
        assert patched.json()["revision"] == 1
        assert (await call(api, "DELETE", item, params={"expected_revision": 0})).status_code == 409
        assert (await call(api, "GET", f"{item}/files/{digest}")).content == body

        library = f"{BASE}/library/files"
        assert (await call(api, "POST", library, files={"upload": ("motion.bin", body)})).json()[
            "key"
        ] == digest
        motion_id = f"user-motion:model-{digest}:0"
        motion = f"{BASE}/motions/{motion_id}"
        data = {"motion": {"name": "试走"}, "resource": {"files": [{"file": digest}]}}
        assert (await call(api, "PUT", motion, json=data)).json() == data
        assert (await call(api, "GET", motion)).json() == data
        assert (await call(api, "GET", f"{BASE}/motions")).json()["items"] == [data["motion"]]

        agent = f"{item}/agent-session"
        call_path = f"{agent}/calls"
        session = (await call(api, "POST", agent)).json()["session_id"]
        request = {"name": "director_read", "arguments": {}, "request_id": "read-scene"}
        pending = asyncio.create_task(call(api, "POST", f"{item}/tools", json=request))
        try:
            queued = await call(api, "GET", call_path, params={"session_id": session, "wait": 5})
            entry = queued.json()["call"]
            assert entry["name"] == request["name"]
            completed = await call(
                api,
                "POST",
                f"{call_path}/{entry['id']}",
                json={"session_id": session, "result": {"revision": 1}},
            )
            assert completed.json() == {"accepted": True}
            assert (await asyncio.wait_for(pending, 5)).json() == {"result": {"revision": 1}}
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
        assert (await call(api, "POST", f"{item}/tools", json=request)).json() == {
            "result": {"revision": 1}
        }

        assert app.state.director_storage.stage_project_root(
            "director-desk", project, owner_user_id=case.viewer
        )

    web = tmp_path / "director-web"
    web.mkdir()
    entry = b"<!doctype html><title>Director release</title>"
    index = web / "index.html"
    index.write_bytes(entry)
    build = "a" * 20
    (web / "build.json").write_text(
        json.dumps(
            {
                "version": 1,
                "service": "director",
                "build_id": build,
                "entry": index.name,
                "api_sha256": public_contract(
                    json.loads(schema_path.read_text()), "director", CATALOG
                ),
                "files": [
                    {
                        "path": index.name,
                        "sha256": hashlib.sha256(entry).hexdigest(),
                        "bytes": len(entry),
                    }
                ],
            }
        )
    )
    restarted = application(web)
    async with client(restarted) as api:
        assert (await api.get("/ready")).status_code == 503
    async with restarted.router.lifespan_context(restarted), client(restarted) as api:
        assert (await api.get("/ready")).json() == {
            "status": "ready",
            "service": "director",
            "version": build,
        }
        assert (await api.get("/apps/director-desk")).content == entry
        assert (await call(api, "GET", f"{item}/files/{digest}")).content == body
        assert (await call(api, "GET", item)).json()["revision"] == 1
        assert (await call(api, "POST", f"{item}/tools", json=request)).status_code == 409
        assert (await call(api, "GET", f"{library}/{digest}")).content == body

        switched = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert switched.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "GET", item)).status_code == 404
        assert (await call(api, "GET", f"{item}/files/{digest}")).status_code == 404
        assert (await call(api, "GET", f"{library}/{digest}")).status_code == 404
    async with client(restarted) as api:
        assert (await api.get("/ready")).status_code == 503
    index.write_bytes(b"bad release")
    with pytest.raises(ValueError, match="程序资源"):
        application(web)


async def test_upload_cannot_recreate_a_concurrently_deleted_project(tmp_path):
    from studio.apps.director_desk.files import DirectorDeskFiles
    from studio.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
    from studio.apps.director_desk.schemas import DirectorProjectCreate
    from studio.apps.director_desk.storage.file_paths import DirectorStorage
    from studio.apps.director_desk.storage.models import DirectorDeskProject
    from studio.runtime.database.sessions import Database

    owner = "eefc5357-745c-4d4c-a84b-dfc6b505268c"
    root = tmp_path / "director"
    apply(root / "service.db", "director", MIGRATIONS)
    database = Database("director", root, models=(DirectorDeskProject,))
    storage = DirectorStorage(root)
    entered, resume = asyncio.Event(), asyncio.Event()

    class Upload:
        closed = False
        started = False

        async def read(self, _size):
            if self.started:
                return b""
            self.started = True
            entered.set()
            await resume.wait()
            return b"late upload"

        async def close(self):
            self.closed = True

    async def store(project_id, upload):
        async with database.sessions(info={"owner_user_id": owner}) as session:
            return await DirectorDeskFiles(session, owner, storage=storage).store_project_file(
                project_id, upload
            )

    try:
        async with database.sessions(info={"owner_user_id": owner}) as session:
            created = await DirectorDeskProjects(session, owner).create(
                DirectorProjectCreate(title="staged")
            )
        upload = Upload()
        pending = asyncio.create_task(store(created.id, upload))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            async with database.sessions(info={"owner_user_id": owner}) as session:
                await DirectorDeskProjects(session, owner).delete(created.id, 0, storage=storage)
            resume.set()
            try:
                await asyncio.wait_for(pending, 5)
            except DirectorDeskError as exc:
                assert exc.status == 404
            else:
                raise AssertionError("upload recreated the deleted project")
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
        assert upload.closed
        assert not storage.project_root("director-desk", created.id, owner_user_id=owner).exists()
    finally:
        await database.close()


def test_director_build_closure_owns_only_its_workshop():
    from studio.deployment.images import source_closure

    closure = source_closure(ROOT, "director")
    assert "studio.apps.director_desk.transport.website" in closure
    assert all(
        module.startswith("studio.apps.director_desk")
        for module in closure
        if module.startswith("app.apps.")
    )
    assert (
        not {
            "studio.assembly.website.application",
            "studio.assembly.website.routes",
            "studio.assembly.website.models",
            "studio.runtime.database.website",
        }
        & closure.keys()
    )
