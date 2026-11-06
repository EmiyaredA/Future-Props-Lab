"""Rehearse an isolated Galgame transfer from the real compatibility website."""

import asyncio
import json
import os
import subprocess
import sys
from contextlib import ExitStack
from io import BytesIO
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migrate_galgame_history import PINS, RECORDS, migrate
from scripts.website.migration_transfer import pages, transfer
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from studio.apps.galgame_workshop.storage.migrations.registry import (
    MIGRATIONS as GALGAME_MIGRATIONS,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, Actor, issue_context
from studio.contracts.management.migration_batches import MigrationPlan
from studio.deployment.images import ENTRY_POINTS
from studio.runtime.database.migrations import apply
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.creative_workshop.test_creative_project_certification import PROJECTS as OWNERS
from tests.apps.tools.test_tools_navigation_migration import available_ports, listener
from tests.integration.test_website_legacy_snapshot import (
    PASSWORD,
    REVISION,
    ROOT,
    configuration,
    website,
)

PROJECTS = "/v1/galgame-workshop/projects"


def seed_project(client, origin):
    login = client.post("/v1/auth/login", json={"username": "e2e-admin", "password": PASSWORD})
    assert login.status_code == 200, login.text
    owner = UUID(login.json()["user"]["id"])
    safe = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
    created = client.post(PROJECTS, headers=safe, json={"title": "Retained Galgame"})
    assert created.status_code == 200, created.text
    path = PROJECTS + "/" + created.json()["id"]
    image = BytesIO()
    Image.new("RGB", (5, 6), "#abcdef").save(image, "PNG")
    blob = image.getvalue()
    uploaded = client.post(
        path + "/assets",
        headers=safe,
        files={"upload": ("retained.png", blob, "image/png")},
        data={"category": "scene"},
    )
    assert uploaded.status_code == 200, uploaded.text
    asset = uploaded.json()
    story = client.get(path + "/story").json()
    document = story["document"]
    document["assets"] = [
        {
            "id": "retained-file",
            "type": "image",
            "role": "sceneLayer",
            "status": "ready",
            "fileId": asset["id"],
        }
    ]
    saved = client.put(
        path + "/story",
        headers=safe,
        json={"expected_revision": story["revision"], "document": document},
    )
    assert saved.status_code == 200, saved.text
    operation_path = path + "/story/operations"
    edit = {
        "request_id": "legacy-story-edit",
        "expected_revision": saved.json()["revision"],
        "settings": {"synopsis": "历史编辑回执"},
        "operations": [
            {"action": "update", "entity": "chapter", "id": "chapter-1", "value": {"title": "历史"}}
        ],
    }
    edited = client.post(operation_path, headers=safe, json=edit)
    assert edited.status_code == 200, edited.text
    snapshot = client.post(
        path + "/story/portrait-upgrade",
        headers=safe,
        json={"expectedStoryRevision": edited.json()["revision"]},
    )
    assert snapshot.status_code == 200, snapshot.text
    current = client.put(
        path + "/story",
        headers=safe,
        json={
            "expected_revision": snapshot.json()["revision"],
            "document": {**snapshot.json()["document"], "assets": []},
        },
    )
    assert current.status_code == 200, current.text
    settings = client.patch(
        path + "/assets/asr/settings",
        headers=safe,
        json={"expectedRevision": 0, "concurrency": 3},
    )
    assert settings.status_code == 200, settings.text
    histories = client.get(path + "/story/snapshots").json()
    assert len(histories) == 1
    video = client.post(
        "/v1/video-editor/projects", headers=safe, json={"title": "Original handoff"}
    )
    assert video.status_code == 200, video.text
    return (
        owner,
        path,
        current.json(),
        blob,
        f"/v1/files/{asset['id']}/download",
        histories[0],
        video.json()["id"],
        (operation_path, edit, edited.json()),
    )


async def seed_job_rows(database, owner, project_id, snapshot, video_id):
    # Use the isolated legacy database to simulate saved worker outcomes.
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    try:
        async with async_sessionmaker(engine)() as db:
            common = {
                "owner_user_id": str(owner),
                "project_id": project_id,
                "snapshot_id": snapshot["id"],
                "story_revision": snapshot["storyRevision"],
                "request_payload": {"preset": "720p30"},
            }
            db.add_all(
                [
                    GalgameVideoExportTask(
                        request_id="retained-export",
                        status="failed",
                        progress=45,
                        error="interrupted render",
                        revision=4,
                        **common,
                    ),
                    GalgameVideoEditorHandoffTask(
                        request_id="retained-handoff",
                        status="completed",
                        progress=100,
                        output_project_id=video_id,
                        result_detail={"trackCount": 3},
                        revision=8,
                        **common,
                    ),
                ]
            )
            await db.commit()
    finally:
        await engine.dispose()


def open_peers(stack, client, root, snapshot, plan_path, *, service, migrations, records):
    peers = {}
    for name, registry, dataset in (
        (service, migrations, records[0]),
        ("assets", ASSET_MIGRATIONS, ASSET_RECORDS[0]),
    ):
        source, target = available_ports()
        state_root = root / name
        apply(state_root / "service.db", name, registry)
        addresses = []
        for mode, port, args in (
            ("export", source, ("--legacy-db", snapshot)),
            ("import", target, ("--state-root", state_root)),
        ):
            addresses.append(
                stack.enter_context(
                    listener(
                        client,
                        port,
                        f"migration-{mode}",
                        plan_path,
                        *args,
                        module=ENTRY_POINTS[name],
                        prefix=dataset.prefix,
                    )
                )
            )
        peers[name] = addresses
    return (*peers[service], *peers["assets"])


def test_galgame_history_preserves_revision_metadata_and_original_rollback(tmp_path):
    runtime = tmp_path / "source/.runtime"
    runtime.mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Galgame rollback</h1>")
    source_port, recovery_port = available_ports()
    config = configuration(
        runtime.parent / "backend/config.toml",
        database=runtime / legacy_snapshot.DATABASE,
        key=Fernet.generate_key().decode(),
        port=source_port,
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
    with website(config, source_port) as (client, origin):
        owner, path, story, png, content_path, saved_snapshot, video_id, edit = seed_project(
            client, origin
        )
    asyncio.run(
        seed_job_rows(
            runtime / legacy_snapshot.DATABASE,
            owner,
            path.rsplit("/", 1)[-1],
            saved_snapshot,
            video_id,
        )
    )
    snapshot = tmp_path / "snapshot"
    proof = legacy_snapshot.create(runtime, config, snapshot, REVISION)
    source_db = snapshot / ".runtime" / legacy_snapshot.DATABASE
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=REVISION,
        source_database_sha256=legacy_snapshot.digest(source_db),
        owner_ids=(owner,),
        token="isolated-galgame-history-synthetic-transfer-authority",
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
        peers = open_peers(
            stack,
            client,
            tmp_path,
            source_db,
            plan_path,
            service="galgame",
            migrations=GALGAME_MIGRATIONS,
            records=RECORDS,
        )
        game_source, game_target, asset_source, asset_target = peers
        headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
        original = next(pages(client, game_source, headers, plan, owner, PINS))
        # The original only remains in an older Story snapshot.
        assert story["document"]["assets"] == []
        assert original.batch.records[0].asset_ids == [content_path.split("/")[-2]]
        for dataset in ASSET_RECORDS:
            transfer(client, plan, asset_source, asset_target, dataset)
        rejected = client.post(
            asset_target + PINS.prefix + "/batches",
            json=original.batch.model_dump(mode="json"),
            headers={**headers, "X-Fpl-Migration-SHA256": original.sha256},
        )
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()["code"] == "migration_reference_file_unverified"
        with pytest.raises((ValueError, httpx.HTTPStatusError)):
            migrate(client, plan, *peers)
        assert transfer_asset_blobs(client, plan, asset_source, asset_target)["record_count"] == 1
        # Resume a partial attempt that already committed its project and Story batches.
        for dataset in RECORDS[:2]:
            transfer(client, plan, game_source, game_target, dataset)
        report = migrate(client, plan, *peers)
        assert report == migrate(client, plan, *peers)
        assert {row["dataset"]: row["record_count"] for row in report} == {
            "galgame.projects": 1,
            "galgame.stories": 1,
            "galgame.snapshots": 1,
            "galgame.asset-links": 0,
            "galgame.asset-metadata": 1,
            "galgame.asset-settings": 1,
            "galgame.asr-jobs": 0,
            "galgame.annotation-jobs": 0,
            "galgame.video-exports": 1,
            "galgame.video-handoffs": 1,
            "galgame.story-pins": 1,
            "galgame.operation-receipts": 1,
        }
        handoff_dataset = next(item for item in RECORDS if item.name == "galgame.video-handoffs")
        handoffs = next(pages(client, game_target, headers, plan, owner, handoff_dataset))
        row = handoffs.batch.records[0]
        assert row.output_project_id == video_id and row.revision == 8
        assert row.snapshot_id == saved_snapshot["id"]
    asyncio.run(verify_edit_replay(tmp_path / "galgame", "galgame", owner, *edit))
    recovered = tmp_path / "recovered"
    legacy_snapshot.restore(snapshot, recovered, REVISION, proof["manifest_sha256"])
    recovered_config = recovered / "backend/acceptance-config.toml"
    recovered_config.touch(mode=0o600)
    # Rebind the verified original configuration to the isolated restore and listener.
    recovered_config.write_text(
        (recovered / legacy_snapshot.CONFIG)
        .read_text()
        .replace(str(runtime), str(recovered / ".runtime"))
        .replace(f"port = {source_port}", f"port = {recovery_port}")
    )
    with website(recovered_config, recovery_port) as (client, _):
        login = client.post("/v1/auth/login", json={"username": "e2e-admin", "password": PASSWORD})
        assert login.status_code == 200, login.text
        assert client.get(path + "/story").json() == story
        assert client.get(content_path).content == png


async def verify_edit_replay(state, service, owner, path, edit, original):
    key = Ed25519PrivateKey.generate()
    factory, *_ = OWNERS[service]
    app = factory(
        state_root=state,
        public_key=key.public_key(),
        credential=CREDENTIALS[service],
        catalog=RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
        run_worker=False,
    )

    def headers(user_id):
        actor = Actor(
            str(user_id),
            "user",
            "session",
            ("studio:read", "studio:private_read", "studio:write"),
            session_id="isolated-replay",
        )
        return {
            HEADER: issue_context(
                actor, service=service, method="POST", path=path, private_key=key, key_id="test"
            )
        }

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=f"http://{service}"
        ) as api,
    ):
        reply = await api.post(path, headers=headers(owner), json=edit)
        assert reply.status_code == 200 and reply.json() == original, reply.text
        different = await api.post(
            path,
            headers=headers(owner),
            json={**edit, "expected_revision": original["revision"]},
        )
        assert different.status_code == 409 and different.json()["code"] == "idempotency_conflict"
        assert (await api.post(path, headers=headers(uuid4()), json=edit)).status_code == 404
