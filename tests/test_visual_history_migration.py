"""Rehearse the Visual Canvas, output and placement history transfer."""

import asyncio
import json
import os
import subprocess
import sys
from contextlib import ExitStack
from datetime import datetime
from io import BytesIO
from uuid import UUID, uuid4

import httpx
from cryptography.fernet import Fernet
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migrate_visual_history import PINS, RECORDS, migrate
from scripts.website.migration_transfer import pages, transfer
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.test_galgame_history_migration import open_peers, verify_edit_replay
from tests.test_tools_navigation_migration import available_ports
from tests.test_website_legacy_snapshot import PASSWORD, REVISION, ROOT, configuration, website

from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask
from fpl_runtime.migration_batches import MigrationPlan
from fpl_visual.migrations.registry import MIGRATIONS

PROJECTS = "/v1/visual-workshop/projects"


def seed_project(client, origin):
    login = client.post("/v1/auth/login", json={"username": "e2e-admin", "password": PASSWORD})
    assert login.status_code == 200, login.text
    owner = UUID(login.json()["user"]["id"])
    safe = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
    created = client.post(
        PROJECTS, headers=safe, json={"title": "Retained Canvas", "kind": "canvas"}
    )
    assert created.status_code == 200, created.text
    path = PROJECTS + "/" + created.json()["id"]
    asset_ids, blobs, placements = [], [], []
    for color in ("red", "blue"):
        image = BytesIO()
        Image.new("RGB", (5, 6), color).save(image, "PNG")
        blob = image.getvalue()
        uploaded = client.post(
            "/v1/files",
            headers=safe,
            files={
                "upload": (color + ".png", blob, "image/png"),
            },
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["id"]
        link = client.post(path + "/asset-references", headers=safe, json={"asset_id": asset_id})
        assert link.status_code == 200, link.text
        asset_ids.append(asset_id)
        blobs.append(blob)
        placements.append(link.json()["reference_id"])
    canvas = client.put(
        path + "/canvas",
        headers=safe,
        json={
            "expected_revision": 0,
            "nodes": [
                {
                    "id": "paint",
                    "kind": "image",
                    "title": "Paint",
                    "position": {"x": 0, "y": 0},
                    "asset_id": asset_ids[0],
                }
            ],
        },
    )
    assert canvas.status_code == 200, canvas.text
    operation_path = path + "/canvas/operations"
    edit = {
        "request_id": "legacy-canvas-edit",
        "expected_revision": canvas.json()["revision"],
        "operations": [
            {"action": "update", "entity": "node", "id": "paint", "value": {"title": "Historical"}}
        ],
    }
    edited = client.post(operation_path, headers=safe, json=edit)
    assert edited.status_code == 200, edited.text
    canvas = edited
    for asset_id in asset_ids:
        canvas = client.post(
            path + "/nodes/paint/outputs",
            headers=safe,
            json={
                "expected_revision": canvas.json()["revision"],
                "asset_id": asset_id,
            },
        )
        assert canvas.status_code == 200, canvas.text
    return (
        owner,
        path,
        canvas.json(),
        asset_ids,
        blobs,
        placements,
        (operation_path, edit, edited.json()),
    )


async def seed_generation(database, owner, project, asset):
    # Populate old worker outcomes in this isolated migration fixture.
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    children = [f"generation-{index}" for index in range(4)]
    submitted = datetime(2026, 1, 2, 3, 4, 5)
    try:
        async with async_sessionmaker(engine)() as session:
            session.add_all(
                VisualGenerationTask(
                    id=task_id,
                    owner_user_id=str(owner),
                    project_id=project,
                    provider_kind="senseaudio_image",
                    generation_kind="image",
                    provider_name="Saved provider",
                    model_slug="saved-model",
                    provider_task_id=f"legacy-{task_id}",
                    submitted_at=submitted,
                    canvas_node_id="paint",
                    request_payload={"prompt": "历史画面"},
                    status="completed",
                    progress=100,
                    result_asset_id=asset,
                    revision=3,
                    completed_at=submitted,
                )
                for task_id in children
            )
            session.add(
                VisualGenerationBatch(
                    id="historical-grid",
                    owner_user_id=str(owner),
                    project_id=project,
                    grid_size=4,
                    grid_output="composite",
                    child_task_ids=children,
                    status="completed",
                    completed_count=4,
                    result_asset_id=asset,
                    revision=5,
                    completed_at=submitted,
                )
            )
            await session.commit()
    finally:
        await engine.dispose()
    return children, submitted


def test_visual_history_preserves_canvas_output_placement_and_rollback(tmp_path):
    runtime = tmp_path / "source/.runtime"
    runtime.mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Visual rollback</h1>")
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
        owner, path, canvas, ids, blobs, placements, edit = seed_project(client, origin)
    children, submitted = asyncio.run(
        seed_generation(runtime / legacy_snapshot.DATABASE, owner, path.rsplit("/", 1)[-1], ids[0])
    )
    snapshot = tmp_path / "snapshot"
    proof = legacy_snapshot.create(runtime, config, snapshot, REVISION)
    source_db = snapshot / ".runtime" / legacy_snapshot.DATABASE
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=REVISION,
        source_database_sha256=legacy_snapshot.digest(source_db),
        owner_ids=(owner,),
        token="isolated-visual-history-synthetic-transfer-authority",
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
            service="visual",
            migrations=MIGRATIONS,
            records=RECORDS,
        )
        visual_source, visual_target, asset_source, asset_target = peers
        headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
        original = next(pages(client, visual_source, headers, plan, owner, PINS))
        assert original.batch.records[0].asset_ids == sorted(ids)
        for dataset in ASSET_RECORDS:
            report = transfer(client, plan, asset_source, asset_target, dataset)
            if dataset.name == "assets.visual-links":
                assert report["record_count"] == 2
                links = next(pages(client, asset_target, headers, plan, owner, dataset))
                assert [row.id for row in links.batch.records] == sorted(placements)
        assert transfer_asset_blobs(client, plan, asset_source, asset_target)["record_count"] == 2
        report = migrate(client, plan, *peers)
        assert report == migrate(client, plan, *peers)
        assert {row["dataset"]: row["record_count"] for row in report} == {
            "visual.projects": 1,
            "visual.canvases": 1,
            "visual.outputs": 3,
            "visual.canvas-pins": 1,
            "visual.operation-receipts": 1,
            "visual.generation-tasks": 4,
            "visual.generation-batches": 1,
        }
        tasks = next(item for item in RECORDS if item.name == "visual.generation-tasks")
        batch = next(item for item in RECORDS if item.name == "visual.generation-batches")
        stored_tasks = [
            record
            for page in pages(client, visual_target, headers, plan, owner, tasks)
            for record in page.batch.records
        ]
        stored_batch = next(
            pages(client, visual_target, headers, plan, owner, batch)
        ).batch.records[0]
        assert [row.id for row in stored_tasks] == children == stored_batch.child_task_ids
        assert stored_batch.revision == 5 and stored_batch.result_asset_id == ids[0]
        assert all(row.submitted_at == submitted and row.revision == 3 for row in stored_tasks)
        assert [row.provider_task_id for row in stored_tasks] == [
            f"legacy-{task_id}" for task_id in children
        ]
    asyncio.run(verify_edit_replay(tmp_path / "visual", "visual", owner, *edit))
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
        assert client.get(path + "/canvas").json() == canvas
        for asset_id, blob in zip(ids, blobs, strict=True):
            assert client.get(f"/v1/files/{asset_id}/download").content == blob
