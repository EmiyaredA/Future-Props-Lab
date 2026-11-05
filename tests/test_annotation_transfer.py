"""Exercise sealed Annotation transfer, retained audio and replayed edits."""

import asyncio
import hashlib
import io
import json
import os
import subprocess
import sys
import wave
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_annotation import verify_projects
from scripts.website.migrate_annotation_references import PINS
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migration_transfer import pages, project_datasets, transfer
from tests.test_tools_navigation_migration import available_ports, listener
from tests.test_website_legacy_snapshot import configuration, website

from studio.apps.asset_library.migration_blobs import BLOBS
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from studio.apps.audio_annotation.projects import AudioAnnotationProjects
from studio.apps.audio_annotation.schemas.operations import AnnotationOperationsIn
from studio.apps.audio_annotation.storage.document_edits import SqlDocumentEdits
from studio.apps.audio_annotation.storage.migrations.registry import MIGRATIONS
from studio.apps.audio_annotation.storage.service_models import MODELS
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
from studio.assembly.independent.audio_annotation.maintenance import COVERAGE, DATASETS
from studio.contracts.audio_annotation.migration import PREFIX
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.operation_errors import OperationError


def wav():
    content = io.BytesIO()
    with wave.open(content, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(bytes(16000))
    return content.getvalue()


def checked(response):
    response.raise_for_status()
    return response.json()


def seed_legacy(tmp_path):
    old = tmp_path / "source" / ".runtime"
    old.mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Annotation transfer fixture</h1>")
    old_port, restore_port = available_ports()
    key = Fernet.generate_key().decode()
    password = "isolated-annotation-rehearsal-Aa9!"
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
    original = wav()
    png = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(png, format="PNG")
    with website(config, old_port) as (client, origin):
        login = checked(
            client.post("/v1/auth/login", json={"username": "e2e-admin", "password": password})
        )
        owner = UUID(login["user"]["id"])
        auth = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        audio = checked(
            client.post(
                "/v1/files", headers=auth, files={"upload": ("annotate.wav", original, "audio/wav")}
            )
        )
        image = checked(
            client.post(
                "/v1/files",
                headers=auth,
                files={"upload": ("other.png", png.getvalue(), "image/png")},
            )
        )
        projects = "/v1/audio-annotation/projects"
        project = checked(
            client.post(
                projects, headers=auth, json={"title": "迁移音频标注", "asset_id": audio["id"]}
            )
        )
        project_path = f"{projects}/{project['id']}"
        operations = project_path + "/document/operations"
        document = checked(client.get(project_path + "/document"))
        request = {
            "request_id": "隔离:编辑",
            "expected_revision": document["revision"],
            "operations": [
                {
                    "action": "update",
                    "entity": "segment",
                    "id": document["segments"][0]["id"],
                    "value": {"text": "保留标注文本", "status": "reviewed"},
                }
            ],
        }
        edited = checked(client.post(operations, headers=auth, json=request))
        waveform = checked(
            client.put(
                project_path + "/waveform",
                headers=auth,
                json={
                    "expected_revision": 0,
                    "duration_ms": project["duration_ms"],
                    "peaks": [[-0.5, 1.0]],
                },
            )
        )
        project = checked(
            client.patch(
                project_path, headers=auth, json={"expected_revision": 0, "title": "原工程改名"}
            )
        )
        cookies = dict(client.cookies)

    sealed = tmp_path / "sealed"
    version = "c" * 40
    receipt = legacy_snapshot.create(old, config, sealed, version)
    restored = tmp_path / "restored"
    legacy_snapshot.restore(sealed, restored, version, receipt["manifest_sha256"])
    restore_config = configuration(
        restored / "backend" / "verify.toml",
        database=restored / ".runtime" / legacy_snapshot.DATABASE,
        key=key,
        port=restore_port,
        web=web,
    )
    with website(restore_config, restore_port) as (client, origin):
        client.cookies.update(cookies)
        auth = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        assert checked(client.get(project_path)) == project
        assert checked(client.get(project_path + "/waveform")) == waveform
        assert checked(client.post(operations, headers=auth, json=request)) == edited
        assert client.get(f"/v1/files/{audio['id']}/content").content == original
    return owner, sealed, version, project, audio, image, waveform, request, edited


def test_annotation_transfer_restarts_and_rebuilds_owned_audio_reference(tmp_path):
    owner, sealed, version, project, audio, image, waveform, request, edited = seed_legacy(tmp_path)
    source_db = sealed / legacy_snapshot.RUNTIME / legacy_snapshot.DATABASE
    other = uuid4()
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=version,
        source_database_sha256=legacy_snapshot.digest(source_db),
        owner_ids=(owner, other),
        token="isolated-annotation-migration-plan-credential",
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps({**plan.model_dump(mode="json"), "token": plan.token.get_secret_value()})
    )
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    state, assets = tmp_path / "annotation", tmp_path / "assets"
    apply(state / "service.db", "annotation", MIGRATIONS)
    apply(assets / "service.db", "assets", ASSET_MIGRATIONS)
    projects, documents, waveforms, operations = project_datasets(PREFIX, DATASETS)
    source_port, target_port = available_ports()

    def open_service(client, module, port, prefix, target=None):
        args = (
            ("migration-export", "--legacy-db", source_db)
            if target is None
            else (
                "migration-import",
                "--state-root",
                target,
            )
        )
        command, *options = args
        return listener(
            client,
            port,
            command,
            plan_file,
            *options,
            module=f"studio.assembly.independent.{module}.cli",
            prefix=prefix,
        )

    def upload(client, target, dataset, batch):
        return client.post(
            target + dataset.prefix + "/batches",
            headers={**headers, "X-Fpl-Migration-SHA256": batch.digest},
            json=batch.model_dump(mode="json"),
        )

    with (
        httpx.Client(timeout=25, trust_env=False) as client,
        open_service(client, "audio_annotation", source_port, projects.prefix) as source,
    ):
        with open_service(
            client, "audio_annotation", target_port, projects.prefix, state
        ) as target:
            project_receipt = transfer(client, plan, source, target, projects)
            assert project_receipt["record_count"] == 1
            missing = client.get(target + COVERAGE, headers=headers)
            assert missing.status_code == 409
            assert missing.json()["code"] == "migration_annotation_project_incomplete"
        with open_service(
            client, "audio_annotation", target_port, projects.prefix, state
        ) as target:
            assert transfer(client, plan, source, target, projects) == project_receipt
            for dataset in (documents, waveforms, operations):
                assert transfer(client, plan, source, target, dataset)["record_count"] == 1
            assert verify_projects(client, plan, source, target)["record_count"] == 1
            peaks = next(pages(client, target, headers, plan, owner, waveforms)).batch
            (record,) = peaks.records
            assert (record.revision, record.peaks) == (waveform["revision"], waveform["peaks"])
            cross_owner = peaks.model_copy(update={"owner_id": other, "batch_id": uuid4()})
            denied = upload(client, target, waveforms, cross_owner)
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_project_owner_conflict"
            edits = next(pages(client, target, headers, plan, owner, operations)).batch
            (operation,) = edits.records
            assert (operation.request_id, operation.result) == (request["request_id"], edited)
            first = checked(upload(client, target, operations, edits))

        with open_service(
            client, "audio_annotation", target_port, projects.prefix, state
        ) as target:
            assert checked(upload(client, target, operations, edits)) == first

        old_port, new_port = available_ports()
        with (
            open_service(client, "asset_library", old_port, ASSET_RECORDS[0].prefix) as old,
            open_service(client, "asset_library", new_port, ASSET_RECORDS[0].prefix, assets) as new,
        ):
            for dataset in ASSET_RECORDS:
                transfer(client, plan, old, new, dataset)
            linked = next(pages(client, source, headers, plan, owner, PINS)).batch
            (pin,) = linked.records
            assert (pin.id, pin.asset_ids, pin.revision) == (
                project["id"],
                (audio["id"],),
                project["revision"],
            )
            rejected = upload(client, new, PINS, linked)
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_reference_file_unverified"
            transfer_asset_blobs(client, plan, old, new)
            wrong_kind = linked.model_copy(
                update={
                    "batch_id": uuid4(),
                    "records": (pin.model_copy(update={"asset_ids": (image["id"],)}),),
                }
            )
            rejected = upload(client, new, PINS, wrong_kind)
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_reference_asset_unavailable"
            denied = upload(
                client,
                new,
                PINS,
                linked.model_copy(update={"owner_id": other, "batch_id": uuid4()}),
            )
            assert denied.status_code == 409
            references = transfer(client, plan, source, new, PINS)
            assert references["record_count"] == 1
            assert transfer(client, plan, source, new, PINS) == references
            checksum = hashlib.sha256(wav()).hexdigest()
            downloaded = client.get(
                f"{new}{BLOBS}/{owner}/{audio['id']}/{checksum}", headers=headers
            )
            downloaded.raise_for_status()
            assert downloaded.content == wav()

    async def replay_as_owner():
        database = Database("annotation", state, models=MODELS)
        try:
            async with database.sessions(info={"owner_user_id": str(owner)}) as session:
                editor = EditDocument(
                    SqlDocumentEdits(
                        session, str(owner), AudioAnnotationProjects(session, sources=None)
                    )
                )
                body = AnnotationOperationsIn.model_validate(request)
                result = await editor.execute(project["id"], body)
                assert result.model_dump(mode="json") == edited
                changed = body.model_copy(update={"expected_revision": body.expected_revision + 1})
                with pytest.raises(OperationError) as conflict:
                    await editor.execute(project["id"], changed)
                assert conflict.value.code == "idempotency_conflict"
        finally:
            await database.close()

    asyncio.run(replay_as_owner())
