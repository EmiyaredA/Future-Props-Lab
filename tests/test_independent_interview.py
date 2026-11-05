"""Interview room and material writes stay inside their independent owner."""

from pathlib import Path

import httpx
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.interview_assistant.application import create_app
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
BASE = "/v1/interview-assistant"
ROOMS = BASE + "/rooms"


async def test_room_receipt_and_material_survive_independent_restart(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "interview"
    apply(state / "service.db", "interview", MIGRATIONS)

    def application():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
        )

    async def call(client, method, path, **kwargs):
        headers = await authorize(case, "interview", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    def client(app):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://interview"
        )

    create = {"title": "Retained interview", "request_id": "independent-interview-create"}
    data = b"# Interview material\nA fictional candidate.\n"
    app = application()
    async with app.router.lifespan_context(app), client(app) as api:
        assert (await api.get(ROOMS)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        executor = await call(api, "GET", BASE + "/executor")
        assert executor.json()["available"] is False
        created = await call(api, "POST", ROOMS, json=create)
        assert created.status_code == 201, created.text
        room = created.json()
        path = f"{ROOMS}/{room['id']}"
        uploaded = await call(
            api,
            "POST",
            path + "/materials",
            params={"expected_revision": 0},
            files={"file": ("candidate.md", data)},
        )
        assert uploaded.status_code == 200, uploaded.text
        material = uploaded.json()["materials"][0]
        download = f"{path}/materials/{material['id']}/download"
        assert (await call(api, "GET", download)).content == data
        stale = await call(
            api,
            "POST",
            path + "/materials",
            params={"expected_revision": 0},
            files={"file": ("duplicate.md", data)},
        )
        assert stale.status_code == 409
        assert len(list(state.glob("accounts/*/interview-assistant/*/materials/*"))) == 1

    restarted = application()
    async with restarted.router.lifespan_context(restarted), client(restarted) as api:
        repeated = await call(api, "POST", ROOMS, json=create)
        assert repeated.json() == uploaded.json()
        assert (await call(api, "GET", download)).content == data
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "GET", path)).status_code == 404
        assert (await call(api, "GET", download)).status_code == 404


async def test_native_interview_worker_delivers_once_after_lost_receipt(scenario, tmp_path):  # noqa: F811
    from uuid import uuid4

    import pytest
    from tests.test_interview_preparation import FakeExecutor

    from app.console.models.accounts import User
    from studio.contracts.agent_workbench.native import NativeLease
    from studio.contracts.interview_assistant.execution import WorkerStatus
    from studio.host.agent_execution.interview_worker import InterviewWorker
    from studio.host.transport import NativeTransport
    from studio.runtime.http.native_ingress import NativeWorkerOptions

    class LoseReceipt(httpx.AsyncBaseTransport):
        def __init__(self, app):
            self.application = httpx.ASGITransport(app=app)
            self.lost = False

        async def handle_async_request(self, request):
            response = await self.application.handle_async_request(request)
            if (
                request.url.path.endswith("/receipt")
                and response.status_code == 200
                and not self.lost
            ):
                self.lost = True
                await response.aclose()
                raise httpx.ReadError("isolated lost receipt", request=request)
            return response

    case = scenario
    state = tmp_path / "native-interview"
    apply(state / "service.db", "interview", MIGRATIONS)
    options = NativeWorkerOptions(
        ingress="i" * 40,
        identity_credential="a" * 40,
        workers={"fixture-mac": "w" * 40},
    )
    case.identity.state.identity_options["service_credentials"]["interview"] = (
        options.identity_credential
    )
    app = create_app(
        state_root=state,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        options=options,
        transport=case.mesh,
    )
    broken = LoseReceipt(app)

    class StripBridge(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            request.url = request.url.copy_with(path=request.url.path.removeprefix("/interview"))
            request.headers["X-Fpl-Native-Ingress"] = options.ingress
            return await broken.handle_async_request(request)

    native = NativeTransport(
        base_url="http://127.0.0.1:19090/interview",
        credential=options.workers["fixture-mac"],
        transport=StripBridge(),
        service="interview",
    )
    execution_count = 0

    async def verify_original(_task, _bundle):
        nonlocal execution_count
        execution_count += 1

    async def probe():
        return WorkerStatus(available=True, code="ready", version="0.163.0-fixture")

    worker_state = tmp_path / "mac-worker"
    worker = InterviewWorker(
        native, worker_state, executor=FakeExecutor(verify_original), probe=probe
    )
    worker.status = await probe()

    async def call(api, method, path, **kwargs):
        headers = await authorize(case, "interview", method, path)
        return await api.request(method, path, headers=headers, **kwargs)

    async with (
        app.router.lifespan_context(app),
        native.client,
        httpx.AsyncClient(
            base_url="http://interview", transport=httpx.ASGITransport(app=app)
        ) as api,
    ):
        assert (
            await api.post("/_native/v1/claim", json=worker.status.model_dump())
        ).status_code == 403
        await native.post("beat", worker.status.model_dump())
        assert (await call(api, "GET", BASE + "/executor")).json()["available"]
        created = await call(
            api, "POST", ROOMS, json={"request_id": "native-first", "title": "Python"}
        )
        room = created.json()
        path = f"{ROOMS}/{room['id']}"
        uploaded = await call(
            api,
            "POST",
            path + "/materials",
            params={"expected_revision": 0},
            files={"file": ("resume.md", "测试项目".encode())},
        )
        original = uploaded.json()["materials"][0]
        prepare = path + "/preparations"
        request = {
            "request_id": "execute-once",
            "expected_revision": 1,
            "role": "Python",
            "jd": "Python",
            "material_id": original["id"],
        }
        queued = await call(api, "POST", prepare, json=request)
        assert queued.status_code == 202, queued.text
        task = queued.json()["tasks"][0]
        endpoint = f"{prepare}/{task['id']}"
        with pytest.raises(httpx.ReadError):
            await worker.poll_once()
        assert execution_count == 1
        assert len(list(worker.receipts.pending())) == 1
        restarted = InterviewWorker(
            native, worker_state, executor=FakeExecutor(verify_original), probe=probe
        )
        restarted.status = await probe()
        await restarted.poll_once()
        assert execution_count == 1
        assert list(restarted.receipts.pending()) == []
        progress = (await call(api, "GET", endpoint + "/events")).json()
        assert progress["status"] == "succeeded"
        assert [event["kind"] for event in progress["events"]] == [
            "started",
            "search",
            "validating",
            "accepted",
        ]
        bundle = await call(api, "GET", endpoint + "/bundle")
        assert bundle.json()["input_hash"] == task["input_hash"]
        assert (await call(api, "GET", endpoint + "/export")).status_code == 200

        updated = (await call(api, "GET", path)).json()
        queued_again = await call(
            api,
            "POST",
            prepare,
            json={**request, "request_id": str(uuid4()), "expected_revision": updated["revision"]},
        )
        assert queued_again.status_code == 202
        claimed = await native.post("claim", restarted.status.model_dump())
        lease = NativeLease.model_validate(claimed["lease"])
        body = {"lease": lease.model_dump(mode="json")}
        async with case.identity.state.database.sessions() as db:
            # Revoke the account in the isolated Identity fixture mid-execution.
            user = await db.get(User, case.viewer)
            user.status = "disabled"
            await db.commit()
        denied = await api.post(
            "/_native/v1/active",
            headers={
                "X-Fpl-Native-Ingress": options.ingress,
                "Authorization": "Bearer " + options.workers["fixture-mac"],
            },
            json=body,
        )
        assert denied.status_code == 410
        assert await native.post(
            "receipt",
            {**body, "outcome": {"status": "failed", "error_code": "task_cancelled"}},
        ) == {"acknowledged": True}
        assert execution_count == 1
