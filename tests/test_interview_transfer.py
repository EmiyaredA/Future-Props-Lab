"""Rehearse sealed Interview history, original bytes and first isolated startup."""

import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from scripts.website import legacy_snapshot
from scripts.website.migrate_interview import transfer_materials
from scripts.website.migration_transfer import pages, project_datasets, transfer
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from tests.test_tools_navigation_migration import available_ports, listener
from tests.test_website_legacy_snapshot import configuration, website

from studio.apps.interview_assistant.rooms import Rooms
from studio.apps.interview_assistant.storage.migration_materials import PREFIX as ORIGINALS
from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS
from studio.apps.interview_assistant.storage.models import InterviewPreparation, InterviewRoom
from studio.assembly.independent.interview_assistant.application import create_app
from studio.assembly.independent.interview_assistant.maintenance import (
    DATASETS,
    PREFIX,
    RELATIONSHIPS,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.interview_assistant.documents import InterviewCreateIn
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.operation_receipts import OperationError

CONTENTS = ("候选人附件内容\n".encode(), b"second isolated material")
ROOMS = "/v1/interview-assistant/rooms"


def checked(response):
    response.raise_for_status()
    return response.json()


def add_fixture_preparations(database, room_id, material):
    """Construct stopped worker history only in the isolated migration fixture."""
    engine = create_engine(f"sqlite:///{database}")
    pending, delivered = str(uuid4()), str(uuid4())
    try:
        with Session(engine) as db:
            room = db.get(InterviewRoom, room_id)
            snapshot = {
                "role": "模拟岗位",
                "jd": "隔离岗位说明",
                "resume": "",
                "duration": "30",
                "material": {key: material[key] for key in ("id", "filename", "sha256")},
            }
            input_hash = hashlib.sha256(
                json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
            bundle = {
                "schema_version": 1,
                "task_id": delivered,
                "input_hash": input_hash,
                "material_summary": "已交付的历史报告",
                "material_complete": True,
                **{
                    key: []
                    for key in (
                        "requirements",
                        "experiences",
                        "topics",
                        "sources",
                        "questions",
                        "first_round",
                        "rubric",
                        "limitations",
                    )
                },
            }
            for identifier, position, status, result in (
                (delivered, 1, "succeeded", bundle),
                (pending, 2, "running", None),
            ):
                db.add(
                    InterviewPreparation(
                        id=identifier,
                        owner_user_id=room.owner_user_id,
                        user_id=room.user_id,
                        room_id=room_id,
                        request_id=f"旧请求:{position}",
                        fingerprint="a" * 64,
                        input_hash=input_hash,
                        input_version=position,
                        snapshot=snapshot,
                        status=status,
                        revision=3,
                        events=[
                            {
                                "sequence": 1,
                                "kind": "step",
                                "message": "原任务事件",
                                "at": "2026-01-01T00:00:00Z",
                                "urls": [],
                            }
                        ],
                        result=result,
                        message="原任务状态",
                    )
                )
            room.active_task_id = pending
            room.active_bundle_id = delivered
            room.input_version = 2
            db.commit()
    finally:
        engine.dispose()
    return pending, delivered, bundle


def seed_legacy(tmp_path):
    old = tmp_path / "source" / ".runtime"
    old.mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Interview transfer fixture</h1>")
    old_port, restored_port = available_ports()
    key = Fernet.generate_key().decode()
    password = "isolated-interview-rehearsal-Aa9!"
    config = configuration(
        tmp_path / "source" / "backend" / "config.toml",
        database=old / legacy_snapshot.DATABASE,
        key=key,
        port=old_port,
        web=web,
    )
    subprocess.run(
        [sys.executable, "scripts/e2e_account.py"],
        env={
            **{name: value for name, value in os.environ.items() if not name.startswith("FPL_")},
            "FPL_CONFIG_FILE": str(config),
            "FPL_E2E_PASSWORD": password,
        },
        timeout=30,
        check=True,
    )
    create = {"request_id": "隔离：" * 27, "title": "原场次"}
    removed = {"request_id": "deleted-room", "title": "已删除场次"}
    with website(config, old_port) as (client, origin):
        login = checked(
            client.post("/v1/auth/login", json={"username": "e2e-admin", "password": password})
        )
        owner = UUID(login["user"]["id"])
        auth = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        room = checked(client.post(ROOMS, headers=auth, json=create))
        room_path = f"{ROOMS}/{room['id']}"
        deleted = checked(client.post(ROOMS, headers=auth, json=removed))
        checked(
            client.delete(
                f"{ROOMS}/{deleted['id']}",
                headers=auth,
                params={"expected_revision": deleted["revision"]},
            )
        )
        for filename, content in zip(("简历.md", "notes.txt"), CONTENTS, strict=True):
            room = checked(
                client.post(
                    room_path + "/materials",
                    headers=auth,
                    params={"expected_revision": room["revision"]},
                    files={"file": (filename, content, "text/plain")},
                )
            )
        cookies = dict(client.cookies)
    task, delivered, bundle = add_fixture_preparations(
        old / legacy_snapshot.DATABASE,
        room["id"],
        room["materials"][0],
    )
    sealed = tmp_path / "sealed"
    version = "e" * 40
    receipt = legacy_snapshot.create(old, config, sealed, version)
    restored = tmp_path / "restored"
    legacy_snapshot.restore(sealed, restored, version, receipt["manifest_sha256"])
    restore_config = configuration(
        restored / "backend" / "verify.toml",
        database=restored / ".runtime" / legacy_snapshot.DATABASE,
        key=key,
        port=restored_port,
        web=web,
    )
    with website(restore_config, restored_port) as (client, origin):
        client.cookies.update(cookies)
        auth = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        recovered = checked(client.post(ROOMS, headers=auth, json=create))
        assert recovered["id"] == room["id"]
        assert recovered["active_bundle_id"] == delivered
        assert checked(client.get(f"{room_path}/preparations/{delivered}/bundle")) == bundle
        assert (
            next(row for row in recovered["tasks"] if row["id"] == task)["status"] == "interrupted"
        )
        for material, original in zip(room["materials"], CONTENTS, strict=True):
            received = client.get(f"{room_path}/materials/{material['id']}/download")
            assert received.content == original
    return owner, sealed, version, room, task, delivered, bundle, create, removed


def test_interview_migrates_history_with_verified_originals_and_safe_startup(tmp_path):
    owner, sealed, version, room, task, delivered, bundle, create, removed = seed_legacy(tmp_path)
    database = sealed / legacy_snapshot.RUNTIME / legacy_snapshot.DATABASE
    other = uuid4()
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=version,
        source_database_sha256=legacy_snapshot.digest(database),
        owner_ids=(owner, other),
        token="isolated-interview-migration-plan-credential",
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps({**plan.model_dump(mode="json"), "token": plan.token.get_secret_value()})
    )
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    state = tmp_path / "interview"
    apply(state / "service.db", "interview", MIGRATIONS)
    rooms, materials, preparations, receipts = project_datasets(PREFIX, DATASETS)
    old_port, new_port = available_ports()

    def open_service(client, port, *args):
        return listener(
            client,
            port,
            args[0],
            plan_file,
            *args[1:],
            module="studio.assembly.independent.interview_assistant.cli",
            prefix=rooms.prefix,
        )

    def open_target(client):
        return open_service(client, new_port, "migration-import", "--state-root", state)

    with (
        httpx.Client(timeout=25, trust_env=False) as client,
        open_service(client, old_port, "migration-export", "--legacy-db", database) as source,
    ):
        first_material = room["materials"][0]
        path = f"{ORIGINALS}/{owner}/{room['id']}/{first_material['id']}"
        with open_target(client) as target:
            assert transfer(client, plan, source, target, rooms)["record_count"] == 1
            assert client.get(target + RELATIONSHIPS, headers=headers).status_code == 409
            assert transfer(client, plan, source, target, materials)["record_count"] == 2
            assert client.put(target + path, headers=headers, content=b"wrong").status_code == 409
            wrong_owner = path.replace(str(owner), str(other), 1)
            assert (
                client.put(target + wrong_owner, headers=headers, content=CONTENTS[0]).status_code
                == 409
            )
            file_receipt = checked(client.put(target + path, headers=headers, content=CONTENTS[0]))
            assert file_receipt["sha256"] == hashlib.sha256(CONTENTS[0]).hexdigest()
        with open_target(client) as target:
            assert transfer(client, plan, source, target, preparations)["record_count"] == 2
            assert transfer(client, plan, source, target, receipts)["record_count"] == 2
            imported = {
                entry.id: entry
                for page in pages(client, target, headers, plan, owner, preparations)
                for entry in page.batch.records
            }
            assert imported[task].status == "running"
            assert imported[delivered].result == bundle
            pending = next(
                page.batch
                for page in pages(client, target, headers, plan, owner, preparations)
                if page.batch.records[0].id == task
            )
            denied = pending.model_copy(update={"owner_id": other, "batch_id": uuid4()})
            rejected = client.post(
                target + preparations.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": denied.digest},
                json=denied.model_dump(mode="json"),
            )
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_project_owner_conflict"
            originals = transfer_materials(client, plan, source, target)
            assert (originals["record_count"], originals["byte_count"]) == (
                2,
                sum(map(len, CONTENTS)),
            )
            assert transfer_materials(client, plan, source, target) == originals
            assert (
                checked(client.put(target + path, headers=headers, content=CONTENTS[0]))
                == file_receipt
            )

    async def first_start():
        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
            public_key=Ed25519PrivateKey.generate().public_key(),
        )
        async with app.router.lifespan_context(app):
            async with app.state.database.sessions(info={"owner_user_id": str(owner)}) as session:
                principal = SimpleNamespace(owner_user_id=str(owner), user_id=str(owner))
                use = Rooms(session, principal)
                result = await use.create(InterviewCreateIn.model_validate(create))
                assert result.id == room["id"]
                assert result.active_bundle_id == delivered
                interrupted = next(entry for entry in result.tasks if entry.id == task)
                assert (interrupted.status, interrupted.revision) == ("interrupted", 4)
                assert interrupted.events[0].message == "原任务事件"
                for material, original in zip(room["materials"], CONTENTS, strict=True):
                    file, filename = await use.material(room["id"], material["id"])
                    assert (filename, file.read_bytes()) == (material["filename"], original)
                with pytest.raises(OperationError) as missing:
                    await use.create(InterviewCreateIn.model_validate(removed))
                assert missing.value.code == "not_found"

    asyncio.run(first_start())
