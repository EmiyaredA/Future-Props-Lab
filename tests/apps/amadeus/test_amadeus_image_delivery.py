"""Worker upload, lost acknowledgements and browser downloads use the owned service."""

import asyncio
import hashlib
import io
import random

import httpx
from PIL import Image

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.amadeus.application import create_app
from studio.host.agent_execution.amadeus_dialogue import DialogueWorker
from studio.host.agent_execution.amadeus_worker import AmadeusWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions
from tests.apps.amadeus.test_amadeus_service_dialogue import Connections
from tests.apps.amadeus.test_amadeus_service_native import (
    CREDENTIAL,
    INGRESS,
    WORKER,
    MacBridge,
    wait_for_intent,
)
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


class LostImageAcknowledgement(MacBridge):
    def __init__(self, app):
        super().__init__(app)
        self.lose_receipt = False
        self.lost_image, self.uploads = False, 0

    async def handle_async_request(self, request):
        response = await super().handle_async_request(request)
        if request.url.path.endswith("/dialogue/images"):
            self.uploads += 1
            if not self.lost_image:
                self.lost_image = True
                await response.aclose()
                raise httpx.ReadError("lost image acknowledgement", request=request)
        return response


async def test_worker_publishes_large_images_once_and_restores_disabled_setting(scenario, tmp_path):  # noqa: F811
    case = scenario
    root = tmp_path / "amadeus"
    root.mkdir()
    apply(root / "service.db", "amadeus", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["amadeus"] = CREDENTIAL
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=CREDENTIAL,
        transport=case.mesh,
        native_options=NativeWorkerOptions(
            ingress=INGRESS, identity_credential=CREDENTIAL, workers={"mac": WORKER}
        ),
    )
    bridge = LostImageAcknowledgement(app)
    transport = NativeTransport(
        service="amadeus",
        base_url="http://127.0.0.1:29090/amadeus",
        credential=WORKER,
        transport=bridge,
    )
    source = io.BytesIO()
    Image.frombytes("RGB", (1024, 1024), random.Random(0).randbytes(1024 * 1024 * 3)).save(
        source, "PNG"
    )
    original = source.getvalue()
    assert len(original) > 2 * 1024 * 1024
    calls = []

    async def runner(_agent, _executable, _model, _prompt, _tools, _call, emit, **options):
        calls.append(options.get("image_generation_enabled", False))
        if not calls[-1]:
            await emit("assistant_delta", {"text": "生图已关闭"})
            return
        for item in ("first", "second"):
            await emit("image_generation", {"item_id": item, "status": "started"})
            await options["save_image"](item, original)

    connections = Connections(tmp_path / "profiles")
    worker = AmadeusWorker(
        transport,
        root,
        tmp_path / "worker",
        probe=lambda: False,
        connections=connections,
        dialogue=DialogueWorker(transport, root, connections, runner=runner),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        await worker.poll_once()

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        created = await send("POST", "/v1/amadeus/conversations")
        path = "/v1/amadeus/conversations/" + created.json()["id"]

        async def execute(**options):
            started = await send("POST", path + "/runs", json={"agent_id": "codex", **options})
            assert started.status_code == 200, started.text
            identity = started.json()["run"]["id"]
            await wait_for_intent(app)
            await worker.poll_once()
            async with asyncio.timeout(3):
                while True:
                    result = (await send("GET", path + "/runs/" + identity)).json()
                    if result["run"]["status"] != "running":
                        assert result["run"]["status"] == "completed", result
                        return result
                    await asyncio.sleep(0.01)

        result = await execute()
        assert calls == [True] and bridge.uploads == 2 and bridge.lost_image
        images = result["run"]["generated_images"]
        assert len(images) == 2
        assert [event["payload"]["status"] for event in result["events"]] == [
            "started",
            "completed",
            "started",
            "completed",
        ]
        assert len(str(result)) < 12_000
        for image in images:
            response = await send("GET", path + "/files/outputs/" + image["name"])
            assert response.content == original
            assert hashlib.sha256(response.content).hexdigest() == image["sha256"]
        messages = (await send("GET", path)).json()["messages"]
        assert messages[-1]["content"] == "" and len(messages[-1]["references"]) == 2
        result = await execute(codex_image_generation=False)
        assert result["run"]["codex_image_generation"] is False
        assert result["run"]["generated_images"] == []
        history = (await send("GET", path + "/runs")).json()
        assert history[-1]["run"]["codex_image_generation"] is False
        assert calls == [True, False] and bridge.uploads == 2
    await transport.close()
