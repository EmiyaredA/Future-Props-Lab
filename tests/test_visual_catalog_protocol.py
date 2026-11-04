"""Keep Visual discovery credential-free and scoped to the live account."""

import asyncio
import hashlib
import io
import json
from types import SimpleNamespace
from zipfile import ZipFile

import httpx
import pytest
from fastapi import FastAPI, UploadFile
from sqlalchemy import select
from tests.test_agent_runtime_service import IDENTITY_TOKEN, INGRESS, TOKEN, NativeBridge
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS, PROJECTS
from tests.test_independent_project_catalog import authorize

from app.apps.visual_workshop.models import (
    VisualAssistantAction,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
)
from app.capabilities.asset_store.library import AssetLibrary
from app.llm.models import ModelEntry, ModelProvider
from fpl_agent_runtime.application import create_app as create_agent_runtime
from fpl_agent_runtime.migrations.registry import MIGRATIONS as AGENT_RUNTIME_MIGRATIONS
from fpl_assets.models import AssetReferencePin, AssetReferenceSet
from fpl_assets.references import AssetReferences
from fpl_host.agent_connections_worker import ConnectionWorker
from fpl_host.transport import NativeTransport
from fpl_models.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from fpl_models.models import ACCOUNT_MODELS, MODELS
from fpl_models.visual_catalog_http import router
from fpl_models.visual_generation_http import router as visual_model_router
from fpl_runtime.agent_connections import (
    AcceptanceAgentCatalog,
    AcceptanceAgentStatus,
    ConnectionOptions,
)
from fpl_runtime.asset_references import ReferenceUpdate
from fpl_runtime.capability_client import CapabilityClient, CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.database import Database
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.motion_preview import FrameFile
from fpl_runtime.thought_archives import ArchiveAuthenticator
from fpl_runtime.visual_acceptance_assets import PURPOSE as ACCEPTANCE_ASSETS_PURPOSE
from fpl_runtime.visual_acceptance_assets import AcceptanceAssetQuery
from fpl_runtime.visual_assistant import ASSET_PURPOSE, AttachmentQuery
from fpl_runtime.visual_catalog import (
    ACCEPTANCE_TARGET,
    AGENT_ACCEPTANCE_PURPOSE,
    AGENT_ACCEPTANCE_TARGET,
    FIXED_ACCEPTANCE_TARGET,
    GENERATION_SOURCE,
    GENERATION_TARGET,
    PURPOSE,
)
from fpl_runtime.visual_generation import ASSET_PURPOSE as GENERATION_ASSETS_PURPOSE
from fpl_runtime.visual_generation import MODEL_PURPOSE as GENERATION_MODEL_PURPOSE
from fpl_runtime.visual_generation import GenerationAssetQuery, GenerationFileScope, ModelSelection
from fpl_runtime.visual_snapshot import ARCHIVE_DOMAIN, ARCHIVE_PREFIX, SnapshotAssetQuery
from fpl_runtime.visual_snapshot import ASSET_PURPOSE as SNAPSHOT_ASSET_PURPOSE


class LostVisualArchiveReceipt(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh, self.drop_next = mesh, False

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if self.drop_next and request.url.path == ARCHIVE_PREFIX + "/settle":
            assert response.status_code == 200
            self.drop_next = False
            await response.aclose()
            raise httpx.ReadError("simulated lost Visual archive receipt", request=request)
        return response


async def seed_catalog(database, owner, suffix):
    async with database.sessions(info={"owner_user_id": owner}) as db:
        for kind, slug, capabilities in (
            ("senseaudio_image", "senseaudio-image-2.0-260319", ["image_generation"]),
            ("openai", f"vision-{suffix}", ["chat", "vision"]),
            ("openai", f"text-{suffix}", ["chat"]),
        ):
            provider = ModelProvider(
                owner_user_id=owner,
                name=f"{kind}-{suffix}",
                kind=kind,
                base_url="https://models.example.test/v1",
                api_key_ciphertext="credential-stays-in-models",
            )
            db.add(provider)
            await db.flush()
            db.add(
                ModelEntry(
                    owner_user_id=owner,
                    provider_id=provider.id,
                    slug=slug,
                    capabilities=capabilities,
                )
            )
        await db.commit()


async def test_visual_catalog_delegates_exact_paths_and_excludes_other_accounts(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "visual"
    models_root = tmp_path / "models"
    factory, migrations, project_model, _ = PROJECTS["visual"]
    apply(root / "service.db", "visual", migrations)
    apply(models_root / "service.db", "models", MODELS_MIGRATIONS)
    credential = "visual-models-test-service-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        visual=CREDENTIALS["visual"], models=credential
    )
    models = FastAPI()
    database = Database("models", models_root, models=MODELS, account_models=ACCOUNT_MODELS)
    models.state.database = database
    models.state.identity_public_key = case.key.public_key()
    models.state.identity = LiveAuthorization(
        service="models", credential=credential, transport=case.mesh
    )
    models.state.settings = SimpleNamespace(fpl_temp_media_upload_url="")
    models.include_router(router)
    models.include_router(visual_model_router)
    case.mesh.apps["models"] = models
    archive_key = "isolated-visual-archive-peer-key-" * 2
    case.assets.state.visual_archive_auth = ArchiveAuthenticator(archive_key, domain=ARCHIVE_DOMAIN)
    transport = LostVisualArchiveReceipt(case.mesh)
    visual = factory(
        archive_key=archive_key,
        state_root=root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["visual"],
        transport=transport,
        run_worker=False,
    )
    case.mesh.apps["visual"] = visual
    assets_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets_live
    for owner, label in ((case.viewer, "own"), (case.owner, "foreign")):
        await seed_catalog(database, owner, label)
        async with visual.state.database.sessions(info={"owner_user_id": owner}) as db:
            db.add(project_model(id=label, title=label, kind="canvas"))
            await db.commit()
        await AssetReferences(case.assets.state.database).replace(
            owner=owner,
            service="visual",
            update=ReferenceUpdate(
                request_id="canvas-" + label,
                resource_kind="canvas",
                resource_id=label,
                resource_revision=0,
                expected_revision=0,
                asset_ids=[],
            ),
        )
    async with (
        models.state.identity.client,
        assets_live.client,
        visual.router.lifespan_context(visual),
        httpx.AsyncClient(transport=case.mesh, base_url="http://visual") as http,
    ):
        options = await authorize(case, "visual", "GET", GENERATION_SOURCE)
        assert (await http.get(GENERATION_SOURCE)).status_code == 401
        response = await http.get(GENERATION_SOURCE, headers=options)
        assert response.status_code == 200, response.text
        available = response.json()["models"]
        assert len(available) == 1 and available[0]["provider_name"] == "senseaudio_image-own"
        assert available[0]["max_prompt_length"] == 6000
        await verify_model_choice(case, visual, http, available[0]["id"], database)
        path = "/v1/visual-workshop/projects/own/acceptance/models"
        response = await http.get(path, headers=await authorize(case, "visual", "GET", path))
        assert response.status_code == 200, response.text
        entries = response.json()["items"]
        assert len(entries) == 1 and entries[0]["slug"] == "vision-own"
        assert "credential" not in response.text and "base_url" not in response.text
        foreign = path.replace("/own/", "/foreign/")
        assert (
            await http.get(foreign, headers=await authorize(case, "visual", "GET", foreign))
        ).status_code == 404
        grant = RequestGrant(
            "visual", PURPOSE, "GET", GENERATION_SOURCE, "models", "GET", GENERATION_TARGET
        )
        token = await visual.state.capabilities.authorize_request(options[HEADER], grant)
        private = "http://models:8080"
        assert (await http.get(private + GENERATION_TARGET, headers=options)).status_code == 401
        assert (
            await http.get(private + ACCEPTANCE_TARGET, headers={HEADER: token})
        ).status_code == 401
        assert (
            await http.get(
                private + GENERATION_TARGET,
                headers={HEADER: token, "Origin": "https://browser.test"},
            )
        ).status_code == 403
        await verify_fixed_acceptance(case, visual, http, models, database, tmp_path)
        await verify_node_context(case, visual, http, entries[0]["id"], transport)
        await verify_conversations(case, visual, http)
        logged_out = await case.browser.post(
            "/v1/auth/logout",
            headers={"Origin": "http://127.0.0.1:19000", "X-CSRF-Token": case.csrf},
        )
        assert logged_out.status_code == 204, logged_out.text
        assert (
            await http.get(private + GENERATION_TARGET, headers={HEADER: token})
        ).status_code == 401
    await database.close()


async def verify_model_choice(case, visual, http, identity, database):
    source = "/v1/visual-workshop/projects/own/generation-tasks"
    original = (await authorize(case, "visual", "POST", source))[HEADER]

    async def query(model_id, *, body=None):
        scope = ModelSelection(model_id=model_id, kind="image")
        token = await visual.state.capabilities.authorize_request(
            original,
            RequestGrant(
                "visual", GENERATION_MODEL_PURPOSE, "POST", source, "models", "POST", scope.path
            ),
        )
        return await http.post(
            "http://models" + scope.path,
            headers={HEADER: token},
            json=(body or scope).model_dump(),
        )

    own = await query(identity)
    assert own.status_code == 200, own.text
    assert own.json()["model_id"] == identity
    assert own.json()["model_slug"] == "senseaudio-image-2.0-260319"
    assert "credential" not in own.text and "base_url" not in own.text
    async with database.sessions(info={"owner_user_id": case.owner}) as session:
        foreign = await session.scalar(
            select(ModelEntry).where(ModelEntry.slug == "senseaudio-image-2.0-260319")
        )
        foreign_id = foreign.id
    assert (await query(foreign_id)).status_code == 404
    assert (
        await query(identity, body=ModelSelection(model_id=foreign_id, kind="image"))
    ).status_code == 403


async def verify_fixed_acceptance(case, visual, http, models, database, root):
    source = "/v1/visual-workshop/acceptance/catalog"
    async with database.sessions(info={"owner_user_id": case.viewer}) as session:
        model = await session.scalar(select(ModelEntry).where(ModelEntry.slug == "vision-own"))
        identity = model.id
    models.state.settings.fpl_acceptance_model_owner_user_id = case.viewer
    models.state.settings.fpl_acceptance_model_id = identity
    case.identity.state.identity_options["service_credentials"]["agent-runtime"] = IDENTITY_TOKEN
    state = root / "agent-runtime"
    apply(state / "service.db", "agent-runtime", AGENT_RUNTIME_MIGRATIONS)
    agent_runtime = create_agent_runtime(
        state_root=state,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        transport=case.mesh,
        options=ConnectionOptions(
            identity_credential=IDENTITY_TOKEN, ingress=INGRESS, workers={"mac": TOKEN}
        ),
    )
    case.mesh.apps["agent-runtime"] = agent_runtime
    transport = NativeTransport(
        service="agent-runtime",
        base_url="http://127.0.0.1:19091/agent-runtime",
        credential=TOKEN,
        transport=NativeBridge(agent_runtime),
    )
    probes = []

    async def fixed(*, probe):
        probes.append(probe)
        return AcceptanceAgentCatalog(
            items=[
                AcceptanceAgentStatus(
                    id=identity,
                    available=identity == "codex",
                    message="已连接" if identity == "codex" else "未配置",
                )
                for identity in ("codex", "claude-code", "opencode", "dsh", "pi")
            ]
        )

    worker = ConnectionWorker(
        transport, root / "host", catalog=None, enable=None, acceptance_status=fixed
    )
    try:
        async with agent_runtime.router.lifespan_context(agent_runtime):
            headers = await authorize(case, "visual", "GET", source)
            requested = asyncio.create_task(http.get(source, headers=headers))
            await worker.poll_once()
            result = await asyncio.wait_for(requested, 8)
            assert result.status_code == 200, result.text
            assert probes == [True]
            items = result.json()["items"][0]["schemes"]
            assert len(items) == 6
            assert {item["id"] for item in items if item["available"]} == {
                "motion-transfer:api",
                "motion-transfer:codex",
            }
            assert items[0]["model_slug"] == "vision-own"
            assert "credential" not in result.text and "executable" not in result.text
            agent_url = "http://agent-runtime:8080" + AGENT_ACCEPTANCE_TARGET
            assert (await http.get(agent_url, headers=headers)).status_code == 401
            unrelated = await authorize(case, "visual", "GET", GENERATION_SOURCE)
            for purpose, target_service, target in (
                (PURPOSE, "models", FIXED_ACCEPTANCE_TARGET),
                (AGENT_ACCEPTANCE_PURPOSE, "agent-runtime", AGENT_ACCEPTANCE_TARGET),
            ):
                with pytest.raises(CapabilityDenied):
                    await visual.state.capabilities.authorize_request(
                        unrelated[HEADER],
                        RequestGrant(
                            "visual",
                            purpose,
                            "GET",
                            GENERATION_SOURCE,
                            target_service,
                            "GET",
                            target,
                        ),
                    )
    finally:
        await transport.close()


async def verify_node_context(case, visual, http, model_id, transport):
    case.assets.state.capabilities = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )

    async def send(method, path, *, service="visual", **kwargs):
        headers = await authorize(case, service, method, path)
        return await http.request(method, f"http://{service}" + path, headers=headers, **kwargs)

    prefix = "/v1/visual-workshop/projects"
    created = await send("POST", prefix, json={"title": "Acceptance project", "kind": "canvas"})
    assert created.status_code == 200, created.text
    project = created.json()["id"]
    root = prefix + "/" + project
    await visual.state.reference_delivery.process_once()

    async def upload(filename, data, content_type):
        reply = await send(
            "POST",
            "/v1/files",
            service="assets",
            data={"project_id": project},
            files={"upload": (filename, data, content_type)},
        )
        assert reply.status_code == 200, reply.text
        return reply.json()["id"]

    from PIL import Image

    png = io.BytesIO()
    Image.new("RGB", (3, 4), "blue").save(png, "PNG")
    image = await upload("character.png", png.getvalue(), "image/png")
    motion = await upload(
        "motion.mp4", bytes.fromhex("0000001866747970") + b"mp42synthetic", "video/mp4"
    )
    output = await upload(
        "output.mp4", bytes.fromhex("0000001866747970") + b"mp42result", "video/mp4"
    )
    folder = await send(
        "POST",
        "/v1/file-folders",
        service="assets",
        json={"scope": "project", "project_id": project, "name": "素材"},
    )
    assert folder.status_code == 200, folder.text
    nested = await send(
        "POST",
        "/v1/file-folders",
        service="assets",
        json={
            "scope": "project",
            "project_id": project,
            "name": "细节",
            "parent_id": folder.json()["id"],
        },
    )
    assert nested.status_code == 200, nested.text
    shared = await send(
        "POST",
        "/v1/files",
        service="assets",
        files={"upload": ("shared.png", png.getvalue(), "image/png")},
    )
    assert shared.status_code == 200, shared.text
    shared_id = shared.json()["id"]
    placed = await send(
        "POST",
        root + "/asset-references",
        service="assets",
        json={"asset_id": shared_id, "folder_id": nested.json()["id"]},
    )
    assert placed.status_code == 200, placed.text
    saved = await send(
        "PUT",
        root + "/canvas",
        json={
            "expected_revision": 0,
            "nodes": [
                {
                    "id": "review",
                    "kind": "video",
                    "title": "Review",
                    "position": {"x": 0, "y": 0},
                    "generation_draft": {
                        "prompt": "Match the motion",
                        "model_id": model_id,
                        "reference_asset_ids": [image, shared_id],
                        "video_asset_ids": [motion],
                        "duration": 3,
                        "ratio": "16:9",
                        "resolution": "720p",
                    },
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    await visual.state.reference_delivery.process_once()
    created_output = await send(
        "POST",
        root + "/nodes/review/outputs",
        json={"expected_revision": 1, "asset_id": output},
    )
    assert created_output.status_code == 200, created_output.text
    path = root + "/nodes/review/acceptance"
    current = await send("GET", path)
    assert current.status_code == 200, current.text
    assert current.json()["revision"] == 0
    selection = {"expected_revision": 0, "scheme_id": "motion-transfer:api"}
    chosen = await send("PUT", path, json=selection)
    assert chosen.status_code == 200, chosen.text
    result = chosen.json()
    assert result["revision"] == 1 and result["canvas_revision"] == 2
    assert result["issues"] == [] and result["prompt"] == "Match the motion"
    assert {(entry["role"], entry["asset_id"]) for entry in result["inputs"]} == {
        ("character", image),
        ("character", shared_id),
        ("motion", motion),
        ("output", output),
    }
    assert (await send("GET", path)).json() == result
    stale = await send("PUT", path, json=selection)
    assert stale.status_code == 409 and stale.json()["current"] == result
    summary = await send("GET", root + "/acceptance/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["items"][0]["state"] == "uninspected"
    assert (await send("GET", path, params={"output_id": "unknown"})).status_code == 404
    query = AcceptanceAssetQuery(asset_ids=[image])
    original = (await authorize(case, "visual", "GET", path))[HEADER]
    with pytest.raises(CapabilityDenied):
        await visual.state.capabilities.authorize_request(
            original,
            RequestGrant(
                "visual",
                ACCEPTANCE_ASSETS_PURPOSE,
                "GET",
                path,
                "assets",
                "POST",
                query.path("foreign"),
            ),
        )

    snapshot = await verify_snapshot(
        case,
        visual,
        send,
        root,
        shared_id,
        nested.json(),
        image,
        motion,
        output,
        (await send("GET", root + "/nodes/review/outputs")).json(),
        model_id,
        png.getvalue(),
    )
    await verify_snapshot_import(send, prefix, snapshot, model_id, transport)
    await verify_generation_inputs(case, visual, http, root, project, image, png.getvalue())


async def verify_generation_inputs(case, visual, http, root, project, image, data):
    source = root + "/generation-tasks"
    actor = (await authorize(case, "visual", "POST", source))[HEADER]

    async def fetch(scope, *, signed_scope=None):
        signed_path = (signed_scope or scope).path(project, "fixture-task")
        token = await visual.state.capabilities.authorize_request(
            actor,
            RequestGrant(
                "visual",
                GENERATION_ASSETS_PURPOSE,
                "POST",
                source,
                "assets",
                "POST",
                signed_path,
            ),
        )
        return await http.post(
            "http://assets" + signed_path,
            headers={HEADER: token},
            json=scope.model_dump(mode="json"),
        )

    metadata = GenerationAssetQuery(asset_ids=[image])
    result = await fetch(metadata)
    assert result.status_code == 200, result.text
    file = result.json()["items"][0]
    assert file["id"] == image and file["byte_size"] == len(data)
    assert "storage_key" not in file
    scope = GenerationFileScope(files=(FrameFile(id=image, revision=file["revision"]),))
    original = await fetch(scope)
    assert original.status_code == 200 and original.content[8:] == data
    wrong = GenerationFileScope(files=(FrameFile(id=image, revision=file["revision"] + 1),))
    assert (await fetch(wrong)).status_code == 409
    assert (await fetch(wrong, signed_scope=scope)).status_code == 403
    with pytest.raises(CapabilityDenied):
        await visual.state.capabilities.authorize_request(
            actor,
            RequestGrant(
                "visual",
                GENERATION_ASSETS_PURPOSE,
                "POST",
                source,
                "assets",
                "POST",
                metadata.path("another-project", "fixture-task"),
            ),
        )


async def verify_snapshot(
    case, visual, send, root, shared, folder, image, motion, output, history, model_id, png
):
    source = root + "/snapshot"
    response = await send("GET", source)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "no-store" in response.headers["cache-control"]
    with ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        payload = json.loads(archive.read("project.json"))
        assert "credential-stays-in-models" not in json.dumps(payload)
        assert payload["model_references"] == {
            model_id: {"provider_kind": "openai", "model_slug": "vision-own"}
        }
        assert payload["acceptance"]["bindings"] == [
            {"node_id": "review", "scheme_id": "motion-transfer:api"}
        ]
        assert payload["outputs"][0]["asset_id"] == output
        assert payload["outputs"][0]["id"] in json.dumps(history)
        assert {item["id"]: item["folder_id"] for item in payload["assets"]}[shared] == folder["id"]
        assert {item["id"]: item["parent_id"] for item in payload["folders"]} == {
            folder["id"]: folder["parent_id"],
            folder["parent_id"]: None,
        }
        assert {item["source_id"] for item in manifest["assets"]} == {
            shared,
            image,
            motion,
            output,
        }
        for item in manifest["assets"]:
            original = archive.read(item["path"])
            assert hashlib.sha256(original).hexdigest() == item["sha256"]
            if item["source_id"] in {shared, image}:
                assert original == png
    foreign = "/v1/visual-workshop/projects/foreign/snapshot"
    assert (await send("GET", foreign)).status_code == 404
    original = (await authorize(case, "visual", "GET", source))[HEADER]
    scope = SnapshotAssetQuery(asset_ids=[image], excluded_generated=[])
    with pytest.raises(CapabilityDenied):
        await visual.state.capabilities.authorize_request(
            original,
            RequestGrant(
                "visual",
                SNAPSHOT_ASSET_PURPOSE,
                "GET",
                source,
                "assets",
                "POST",
                scope.path("foreign"),
            ),
        )

    return response.content, payload, manifest


async def verify_snapshot_import(send, prefix, snapshot, model_id, transport):
    data, original, source_manifest = snapshot
    uploads = {"file": ("visual.zip", data, "application/zip")}
    path = prefix + "/snapshot-imports"
    before = (await send("GET", prefix)).json()
    transport.drop_next = True
    interrupted = await send("POST", path, files=uploads)
    assert interrupted.status_code == 503, interrupted.text
    assert not transport.drop_next
    assert (await send("GET", prefix)).json() == before

    retried = await send("POST", path, files=uploads)
    assert retried.status_code == 200, retried.text
    project = retried.json()["project"]
    assert project["title"].endswith("（副本）") and retried.json()["warnings"] == []
    root = prefix + "/" + project["id"]
    canvas = (await send("GET", root + "/canvas")).json()
    assert canvas["nodes"][0]["id"] != "review"
    assert canvas["nodes"][0]["generation_draft"]["model_id"] == model_id
    restored = await send("GET", root + "/snapshot")
    assert restored.status_code == 200, restored.text
    with ZipFile(io.BytesIO(restored.content)) as archive:
        payload = json.loads(archive.read("project.json"))
        manifest = json.loads(archive.read("manifest.json"))
        assert {row["id"] for row in payload["assets"]}.isdisjoint(
            row["id"] for row in original["assets"]
        )
        assert sorted(row["sha256"] for row in manifest["assets"]) == sorted(
            row["sha256"] for row in source_manifest["assets"]
        )
        assert payload["acceptance"]["bindings"] == [
            {"node_id": canvas["nodes"][0]["id"], "scheme_id": "motion-transfer:api"}
        ]
        assert (
            len(payload["outputs"]) == 1
            and payload["outputs"][0]["id"] != original["outputs"][0]["id"]
        )
        folders = {row["name"]: row for row in payload["folders"]}
        assert folders["细节"]["parent_id"] == folders["素材"]["id"]
        assert (
            next(row for row in payload["assets"] if row["display_name"] == "shared")["folder_id"]
            == folders["细节"]["id"]
        )

    copied = await send("POST", path, files=uploads)
    assert copied.status_code == 200 and copied.json()["project"]["id"] != project["id"]


async def verify_conversations(case, visual, http):
    base = "/v1/visual-workshop/projects/own/conversations"

    async def request(method, path, **kwargs):
        headers = await authorize(case, "visual", method, path.split("?")[0])
        return await http.request(method, path, headers=headers, **kwargs)

    assert (await request("GET", base)).json() == {"items": []}
    options = (await request("GET", base + "/models")).json()["items"]
    assert {item["slug"] for item in options} == {"text-own", "vision-own"}
    response = await request("POST", base)
    assert response.status_code == 200, response.text
    created = response.json()
    conversation = created["id"]
    path = base + "/" + conversation
    assert created["model_slug"] in {"text-own", "vision-own"}
    assert created["messages"] == []
    assert (await request("GET", base)).json()["items"][0]["id"] == conversation
    foreign = path.replace("/own/", "/foreign/")
    assert (await request("GET", foreign)).status_code == 404
    assert (
        await request("PATCH", path, json={"expected_revision": 0, "model_id": "foreign-model"})
    ).json()["code"] == "model_unavailable"
    await visual.state.reference_delivery.process_once()
    attachments = case.assets.state.database
    async with attachments.sessions(info={"owner_user_id": case.viewer}) as session:
        asset = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"example attachment"), filename="attached.txt"),
            owner_user_id=case.viewer,
        )
        asset_id = asset.id
    # Reproduce the migration projection for a previously saved attachment.
    await AssetReferences(attachments).replace(
        owner=case.viewer,
        service="visual",
        update=ReferenceUpdate(
            request_id="historical-assistant-attachment",
            resource_kind="conversation",
            resource_id=conversation,
            resource_revision=0,
            expected_revision=2,
            asset_ids=[asset_id],
        ),
    )
    async with visual.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        message = VisualAssistantMessage(
            id="old-message",
            conversation_id=conversation,
            position=0,
            turn_id="old-turn",
            role="assistant",
            content="history",
            status="completed",
        )
        db.add(message)
        await db.flush()
        db.add(VisualAssistantMessageAsset(message_id=message.id, asset_id=asset_id, position=0))
        db.add(
            VisualAssistantAction(
                message_id=message.id,
                action_id="action",
                run_id="old-run",
                position=0,
                tool_name="canvas_summary",
                effect="read",
                status="completed",
            )
        )
        await db.commit()
    response = await request("GET", path)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["messages"][0]["assets"] == [
        {"id": asset_id, "display_name": "attached", "mime_type": "text/plain", "byte_size": 18}
    ]
    assert result["messages"][0]["actions"][0]["tool_name"] == "canvas_summary"
    query = AttachmentQuery(asset_ids=[asset_id])
    original = (await authorize(case, "visual", "GET", path))[HEADER]
    client = visual.state.capabilities
    with pytest.raises(CapabilityDenied):
        await client.authorize_request(
            original,
            RequestGrant(
                "visual",
                ASSET_PURPOSE,
                "GET",
                path,
                "assets",
                "POST",
                query.path("foreign", conversation),
            ),
        )
    target = query.path("own", conversation)
    delegated = await client.authorize_request(
        original, RequestGrant("visual", ASSET_PURPOSE, "GET", path, "assets", "POST", target)
    )
    changed = await http.post(
        "http://assets:8080" + target, headers={HEADER: delegated}, json={"asset_ids": [case.asset]}
    )
    assert changed.status_code == 403
    patched = await request("PATCH", path, json={"expected_revision": 0, "title": "renamed"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "renamed" and patched.json()["revision"] == 1
    conflict = await request("DELETE", path + "?expected_revision=0")
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["current"] == patched.json()
    deleted = await request("DELETE", path + "?expected_revision=1")
    assert deleted.status_code == 200 and deleted.json() == {"deleted": True}
    assert (await request("GET", path)).status_code == 404
    await visual.state.reference_delivery.recover()
    await visual.state.reference_delivery.process_once()
    async with attachments.sessions(info={"owner_user_id": case.viewer}) as db:
        projection = await db.scalar(
            select(AssetReferenceSet).where(
                AssetReferenceSet.resource_kind == "conversation",
                AssetReferenceSet.resource_id == conversation,
            )
        )
        assert projection.deleted and projection.resource_revision == 2
        assert await db.get(AssetReferencePin, (projection.id, asset_id)) is None
