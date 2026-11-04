"""Move real compatibility-site editing history and rehearse its sealed rollback."""

import asyncio
import json
import os
import subprocess
import sys
import time
from contextlib import AsyncExitStack, ExitStack
from io import BytesIO
from uuid import UUID, uuid4

import httpx
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migrate_editing_history import (
    ASSET_SCOPES,
    MOTION,
    MOTION_OUTPUTS,
    VIDEO,
    VIDEO_VARIANTS,
    transfer_artifacts,
    transfer_history,
    verify_originals,
)
from scripts.website.migration_transfer import pages, transfer
from tests.test_community_asset_protocol import CATALOG, Mesh
from tests.test_tools_navigation_migration import available_ports, listener
from tests.test_website_legacy_snapshot import PASSWORD, REVISION, ROOT, configuration, website

from fpl_assets.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from fpl_motion.application import create_app as create_motion
from fpl_motion.migrations.registry import MIGRATIONS as MOTION_MIGRATIONS
from fpl_rendering.application import create_app as create_rendering
from fpl_rendering.migrations.registry import MIGRATIONS as RENDERING_MIGRATIONS
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.claims import HEADER, Actor, issue_context
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migration_batches import MigrationPlan
from fpl_runtime.migrations import apply
from fpl_video.application import create_app as create_video
from fpl_video.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS

MOTION_PROJECTS = "/v1/motion-compositor/projects"
VIDEO_PROJECTS = "/v1/video-editor/projects"


def create_editor_history(client, origin, image):
    login = client.post("/v1/auth/login", json={"username": "e2e-admin", "password": PASSWORD})
    assert login.status_code == 200, login.text
    owner = UUID(login.json()["user"]["id"])
    headers = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}

    def post(path, **kwargs):
        result = client.post(path, headers=headers, **kwargs)
        assert result.status_code == 200, result.text
        return result.json()

    motion = post(MOTION_PROJECTS, json={"title": "Retained Motion"})
    video = post(VIDEO_PROJECTS, json={"title": "Retained Video"})
    motion_path = f"{MOTION_PROJECTS}/{motion['id']}"
    video_path = f"{VIDEO_PROJECTS}/{video['id']}"
    originals = [
        post(path + "/assets", files={field: ("original.png", image, "image/png")})
        for path, field in ((motion_path, "file"), (video_path, "upload"))
    ]
    motion_doc = post(
        motion_path + "/document/operations",
        json={
            "requestId": "retained-motion-edit",
            "expectedRevision": 0,
            "operations": [{"type": "updateSettings", "patch": {"durationFrames": 90}}],
        },
    )
    video_doc = post(
        video_path + "/timeline/operations",
        json={
            "requestId": "retained-video-edit",
            "expectedRevision": 0,
            "operations": [
                {
                    "type": "addClip",
                    "clip": {
                        "id": "retained-image",
                        "trackId": "visual-1",
                        "kind": "image",
                        "name": "Retained image",
                        "durationUs": 1_000_000,
                        "timelineStartUs": 0,
                        "assetId": originals[1]["id"],
                    },
                }
            ],
        },
    )
    export = post(
        motion_path + "/exports",
        json={
            "requestId": "retained-motion-output",
            "expectedRevision": motion_doc["revision"],
            "formats": ["mp4", "png-sequence"],
            "startFrame": 0,
            "endFrame": 2,
        },
    )
    for _ in range(160):
        outcome = client.get(motion_path + "/exports/" + export["id"]).json()
        if outcome["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.1)
    assert outcome["status"] == "completed", outcome
    video_assets = client.get(video_path + "/assets").json()["items"]
    for _ in range(100):
        if video_assets[0]["processingStatus"] in ("ready", "failed"):
            break
        time.sleep(0.1)
        video_assets = client.get(video_path + "/assets").json()["items"]
    assert video_assets[0]["processingStatus"] == "ready", video_assets
    routes = {
        "motion": tuple(outcome["outputs"].values()),
        "video": (video_assets[0]["thumbnailUrl"],),
    }
    outputs = {
        service: [(url, client.get(url).content) for url in urls]
        for service, urls in routes.items()
    }
    assert all(raw for files in outputs.values() for _url, raw in files)
    return owner, (motion_path, video_path), (motion_doc, video_doc), originals, outputs


def test_editing_history_scopes_and_sealed_rollback(tmp_path):
    runtime = tmp_path / "legacy/.runtime"
    runtime.mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Editing rollback</h1>")
    original_port, rollback_port = available_ports()
    key = Fernet.generate_key().decode()
    config = configuration(
        runtime.parent / "backend/config.toml",
        database=runtime / legacy_snapshot.DATABASE,
        key=key,
        port=original_port,
        web=web,
    )
    subprocess.run(
        [sys.executable, "scripts/e2e_account.py"],
        cwd=ROOT,
        env={
            **{name: value for name, value in os.environ.items() if not name.startswith("FPL_")},
            "FPL_CONFIG_FILE": str(config),
            "FPL_E2E_PASSWORD": PASSWORD,
        },
        check=True,
        timeout=30,
    )
    source = BytesIO()
    Image.new("RGB", (4, 5), "#aabbcc").save(source, format="PNG")
    image = source.getvalue()
    with website(config, original_port) as (client, origin):
        owner, paths, documents, originals, outputs = create_editor_history(client, origin, image)
        cookies = dict(client.cookies)

    snapshot = tmp_path / "snapshot"
    proof = legacy_snapshot.create(runtime, config, snapshot, REVISION)
    legacy_db = snapshot / ".runtime" / legacy_snapshot.DATABASE
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=REVISION,
        source_database_sha256=legacy_snapshot.digest(legacy_db),
        owner_ids=(owner,),
        token="editing-history-synthetic-credential-" * 2,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.touch(mode=0o600)
    plan_path.write_text(
        json.dumps(
            {
                **plan.model_dump(mode="json", exclude={"token"}),
                "token": plan.token.get_secret_value(),
            }
        )
    )
    with httpx.Client(timeout=20, trust_env=False) as client, ExitStack() as stack:
        endpoints = {}
        for service, registry, prefix in (
            ("assets", ASSET_MIGRATIONS, ASSET_RECORDS[0].prefix),
            ("motion", MOTION_MIGRATIONS, MOTION[0].prefix),
            ("video", VIDEO_MIGRATIONS, VIDEO[0].prefix),
        ):
            source_port, target_port = available_ports()
            target = tmp_path / service
            apply(target / "service.db", service, registry)
            endpoints[service] = (
                stack.enter_context(
                    listener(
                        client,
                        source_port,
                        "migration-export",
                        plan_path,
                        "--legacy-db",
                        legacy_db,
                        module=f"fpl_{service}",
                        prefix=prefix,
                    )
                ),
                stack.enter_context(
                    listener(
                        client,
                        target_port,
                        "migration-import",
                        plan_path,
                        "--state-root",
                        target,
                        module=f"fpl_{service}",
                        prefix=prefix,
                    )
                ),
            )

        headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
        assets_source, assets_target = endpoints["assets"]
        original = next(pages(client, assets_source, headers, plan, owner, ASSET_SCOPES))
        rejected = client.post(
            assets_target + ASSET_SCOPES.prefix + "/batches",
            json=original.batch.model_dump(mode="json"),
            headers={**headers, "X-Fpl-Migration-SHA256": original.sha256},
        )
        assert rejected.status_code == 409
        assert rejected.json()["code"] == "migration_editing_files_incomplete"
        for dataset in ASSET_RECORDS:
            transfer(client, plan, assets_source, assets_target, dataset)
        assert transfer_asset_blobs(client, plan, assets_source, assets_target)["record_count"] == 2
        verify_originals(client, plan, assets_source, assets_target)

        for service, spec, expected in (
            ("motion", MOTION, (1, 1, 1, 1)),
            ("video", VIDEO, (1, 1, 1, 1, 1)),
        ):
            reports = transfer_history(client, plan, *endpoints[service], spec)
            assert tuple(report["record_count"] for report in reports) == expected
            assert transfer_history(client, plan, *endpoints[service], spec) == reports
        scopes = transfer(client, plan, assets_source, assets_target, ASSET_SCOPES)
        assert scopes["record_count"] == 2
        assert transfer(client, plan, assets_source, assets_target, ASSET_SCOPES) == scopes

        rendering_port, _ = available_ports()
        rendering_root = tmp_path / "rendering"
        apply(rendering_root / "service.db", "rendering", RENDERING_MIGRATIONS)
        destination = stack.enter_context(
            listener(
                client,
                rendering_port,
                "migration-import",
                plan_path,
                "--state-root",
                rendering_root,
                module="fpl_rendering",
                prefix=MOTION_OUTPUTS.prefix,
            )
        )
        motion_source = endpoints["motion"][0]
        transfer(client, plan, motion_source, destination, MOTION_OUTPUTS)
        first = next(
            pages(client, motion_source, headers, plan, owner, MOTION_OUTPUTS)
        ).batch.records[0]
        item = first.files[0]
        file_path = f"{MOTION_OUTPUTS.prefix}/files/{owner}/{first.id}/{item.key}/{item.sha256}"
        assert (
            client.put(destination + file_path, headers=headers, content=b"partial").status_code
            == 409
        )
        assert client.head(destination + file_path, headers=headers).status_code == 409
        for service, dataset, count in (
            ("motion", MOTION_OUTPUTS, 2),
            ("video", VIDEO_VARIANTS, 1),
        ):
            reports = transfer_artifacts(client, plan, endpoints[service][0], destination, dataset)
            assert reports[0]["record_count"] == 1 and reports[1]["record_count"] == count
            assert reports == transfer_artifacts(
                client, plan, endpoints[service][0], destination, dataset
            )

    asyncio.run(check_independent_outputs(tmp_path, str(owner), outputs))
    target = tmp_path / "restored"
    assert legacy_snapshot.restore(snapshot, target, REVISION, proof["manifest_sha256"]) == proof
    launch = configuration(
        target / "backend/rehearsal.toml",
        database=target / ".runtime" / legacy_snapshot.DATABASE,
        key=key,
        port=rollback_port,
        web=web,
    )
    with website(launch, rollback_port) as (client, _origin):
        client.cookies.update(cookies)
        assert client.get("/v1/auth/me").json()["user"]["id"] == str(owner)
        assert client.get(paths[0] + "/document").json() == documents[0]
        assert client.get(paths[1] + "/timeline").json() == documents[1]
        for asset in originals:
            assert client.get("/v1/files/" + asset["id"] + "/download").content == image


async def check_independent_outputs(root, owner, outputs):
    key = Ed25519PrivateKey.generate()
    peer = "isolated-editing-runtime-" * 2
    media = "isolated-media-runtime-" * 2
    mesh = Mesh()
    render = create_rendering(
        settings=RenderingSettings(root / "rendering/service.db"),
        public_key=key.public_key(),
        catalog=CATALOG,
        identity=LiveAuthorization(service="rendering", credential=peer, transport=mesh),
        capabilities=CapabilityClient(
            service="rendering", credential=peer, catalog=CATALOG, transport=mesh
        ),
        run_worker=False,
        export_key=peer,
        video_media_key=media,
        video_originals_key="isolated-originals-runtime-" * 2,
    )
    mesh.apps["rendering"] = render
    apps = {
        "motion": create_motion(
            state_root=root / "motion",
            catalog=CATALOG,
            public_key=key.public_key(),
            credential="isolated-motion-runtime-" * 2,
            export_key=peer,
            transport=mesh,
            run_worker=False,
        ),
        "video": create_video(
            state_root=root / "video",
            catalog=CATALOG,
            public_key=key.public_key(),
            credential="isolated-video-runtime-" * 2,
            media_key=media,
            schema_path=ROOT / "web/src/generated/openapi.json",
            transport=mesh,
            run_worker=False,
        ),
    }
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(render.router.lifespan_context(render))
        for service, app in apps.items():
            await stack.enter_async_context(app.router.lifespan_context(app))
            client = await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url=f"http://{service}"
                )
            )
            for path, expected in outputs[service]:
                context = issue_context(
                    Actor(
                        owner,
                        "user",
                        "session",
                        ("studio:read", "studio:private_read"),
                        session_id=owner,
                    ),
                    service=service,
                    method="GET",
                    path=path,
                    private_key=key,
                    key_id="isolated",
                )
                received = await client.get(path, headers={HEADER: context})
                assert received.status_code == 200, received.text
                assert received.content == expected
                partial = await client.get(path, headers={HEADER: context, "Range": "bytes=0-7"})
                assert partial.status_code == 206 and partial.content == expected[:8]
