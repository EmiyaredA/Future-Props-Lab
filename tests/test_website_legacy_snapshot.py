"""Seal and restart a real compatibility website with an isolated data bundle."""

import json
import os
import subprocess
import sys
import time
import tomllib
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migrate_director import DIRECTOR_RECORDS, transfer_director_files
from scripts.website.migrate_identity import CREDENTIALS
from scripts.website.migrate_identity_avatars import transfer_avatars
from scripts.website.migrate_model_catalog import CATALOG as MODEL_CATALOG
from scripts.website.migrate_model_catalog import POLICIES as MODEL_POLICIES
from scripts.website.migrate_remote_preferences import PREFERENCES
from scripts.website.migrate_tools_navigation import NAVIGATION
from scripts.website.migration_coverage import inspect_bundle
from scripts.website.migration_transfer import pages, transfer
from tests.test_tools_navigation_migration import available_ports, listener

from fpl_assets.migration_blobs import BLOBS as ASSET_BLOBS
from fpl_assets.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from fpl_director.migration_files import FILES as DIRECTOR_FILES
from fpl_director.migrations.registry import MIGRATIONS as DIRECTOR_MIGRATIONS
from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from fpl_models.migrations.registry import MIGRATIONS as MODEL_MIGRATIONS
from fpl_remote.migrations.registry import MIGRATIONS as REMOTE_MIGRATIONS
from fpl_runtime.migration_batches import MigrationPlan
from fpl_runtime.migrations import apply
from fpl_tools.migrations.registry import MIGRATIONS as TOOLS_MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "Isolated-rollback-credential-2026!"
REVISION = "3" * 40
AVATAR = "/v1/account/profile/avatar"
TOOLS = "/v1/tool-navigation/state"


def configuration(path, *, database, key, port, web):
    path.parent.mkdir(parents=True, exist_ok=True)
    values = (
        "[storage]\ndatabase_path = "
        + json.dumps(str(database))
        + "\n[security]\nsecrets_key = "
        + json.dumps(key)
        + f"\n[website]\nport = {port}\npublic_enabled = false\nweb_root = "
        + json.dumps(str(web))
        + "\n[agent_workbench]\nenabled = false\n"
    )
    path.touch(mode=0o600)
    path.write_text(values)
    return path


@contextmanager
def website(config, port):
    origin = f"http://127.0.0.1:{port}"
    with (
        subprocess.Popen(
            [sys.executable, "scripts/website/serve.py", "--config", str(config)],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
        ) as proc,
        httpx.Client(base_url=origin, trust_env=False, timeout=5) as client,
    ):
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline and proc.poll() is None:
                try:
                    if client.get("/ready").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            else:
                pytest.fail("Isolated compatibility website failed to start")
            yield client, origin
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=15)


def migrate_rehearsal(snapshot_db, parent, account, manifest_sha256):
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=REVISION,
        source_database_sha256=legacy_snapshot.digest(snapshot_db),
        owner_ids=(UUID(account),),
        token="sealed-rollback-synthetic-transfer-authority",
    )
    path = parent / "transfer.json"
    path.touch(mode=0o600)
    path.write_text(
        json.dumps(
            {
                **plan.model_dump(mode="json", exclude={"token"}),
                "token": plan.token.get_secret_value(),
            }
        )
    )
    report = inspect_bundle(
        snapshot_db.parent.parent,
        plan=plan,
        manifest_sha256=manifest_sha256,
        catalog=json.loads((ROOT / "deploy/contracts/ownership.json").read_text()),
    )
    indexed = {item["table"]: item for item in report["tables"]}
    assert indexed["visual_assets"]["dataset"] == "assets.files"
    assert indexed["visual_asset_folders"]["record_count"] == 2
    assert indexed["users"]["dataset"] == "identity.accounts"
    assert indexed["director_desk_projects"]["dataset"] == "director.projects"
    assert indexed["agent_workbench_search"]["status"] == "rebuild_pending"
    assert indexed["model_catalog_state"]["dataset"] == "models.catalog-state"
    assert "interview_rooms" in report["pending_tables"]
    with pytest.raises(ValueError, match="清单摘要"):
        inspect_bundle(snapshot_db.parent.parent, plan=plan, manifest_sha256="0" * 64, catalog={})
    for service, migrations, datasets in (
        ("identity", IDENTITY_MIGRATIONS, CREDENTIALS),
        ("assets", ASSET_MIGRATIONS, ASSET_RECORDS),
        ("models", MODEL_MIGRATIONS, MODEL_CATALOG + MODEL_POLICIES),
        ("tools", TOOLS_MIGRATIONS, (NAVIGATION,)),
        ("remote", REMOTE_MIGRATIONS, (PREFERENCES,)),
        ("director", DIRECTOR_MIGRATIONS, DIRECTOR_RECORDS),
    ):
        root = parent / f"independent-{service}"
        apply(root / "service.db", service, migrations)
        source_port, target_port = available_ports()
        settings = {"module": f"fpl_{service}", "prefix": datasets[0].prefix}
        flags = ()
        if service == "models":
            config_file = parent / "models-maintenance.toml"
            key = tomllib.loads((snapshot_db.parent.parent / legacy_snapshot.CONFIG).read_text())[
                "security"
            ]["secrets_key"]
            config_file.touch(mode=0o600)
            config_file.write_text(
                "[storage]\ndatabase_path = "
                + json.dumps(str(root / "service.db"))
                + "\n[security]\nsecrets_key = "
                + json.dumps(key)
                + "\n"
            )
            flags = ("--config", config_file)
        with (
            httpx.Client(timeout=5, trust_env=False) as client,
            listener(
                client,
                source_port,
                "migration-export",
                path,
                "--legacy-db",
                snapshot_db,
                **settings,
            ) as source,
            listener(
                client,
                target_port,
                "migration-import",
                path,
                "--state-root",
                root,
                *flags,
                **settings,
            ) as destination,
        ):
            reports = [transfer(client, plan, source, destination, item) for item in datasets]
            if service == "models":
                assert all(report["record_count"] >= 1 for report in reports)
                assert reports[-1]["record_count"] >= 3
            else:
                assert reports[0]["record_count"] == (2 if service == "assets" else 1)
            assert reports == [
                transfer(client, plan, source, destination, item) for item in datasets
            ]
            if service == "identity":
                assert transfer_avatars(client, plan, source, destination)["record_count"] == 1
            if service == "models":
                wrong = parent / "wrong-model-key"
                apply(wrong / "service.db", "models", MODEL_MIGRATIONS)
                wrong_config = parent / "models-wrong-key.toml"
                wrong_config.touch(mode=0o600)
                wrong_config.write_text(
                    "[storage]\ndatabase_path = "
                    + json.dumps(str(wrong / "service.db"))
                    + "\n[security]\nsecrets_key = "
                    + json.dumps(Fernet.generate_key().decode())
                    + "\n"
                )
                extra_port, _ = available_ports()
                headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
                providers = datasets[1]
                original = next(pages(client, source, headers, plan, UUID(account), providers))
                assert any(row.api_key_ciphertext for row in original.batch.records)
                with listener(
                    client,
                    extra_port,
                    "migration-import",
                    path,
                    "--state-root",
                    wrong,
                    "--config",
                    wrong_config,
                    **settings,
                ) as bad_target:
                    rejected = client.post(
                        bad_target + providers.prefix + "/batches",
                        headers={**headers, "X-Fpl-Migration-SHA256": original.sha256},
                        json=original.batch.model_dump(mode="json"),
                    )
                assert rejected.status_code == 409
                assert rejected.json()["code"] == "migration_model_credential_unreadable"
            if service == "assets":
                assert [report["record_count"] for report in reports] == [2, 1]
                headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
                original = client.get(f"{source}{ASSET_BLOBS}/{account}", headers=headers).json()
                assert len(original) == 1
                entry = original[0]
                route = f"{ASSET_BLOBS}/{account}/{entry['id']}/{entry['sha256']}"
                wrong = client.put(destination + route, headers=headers, content=b"invalid")
                assert wrong.status_code == 409
                assert (
                    client.get(f"{destination}{ASSET_BLOBS}/{account}", headers=headers).json()
                    == []
                )
                migrated = transfer_asset_blobs(client, plan, source, destination)
                assert migrated["record_count"] == 1
                assert transfer_asset_blobs(client, plan, source, destination) == migrated
                different_digest = route.rsplit("/", 1)[0] + "/" + "0" * 64
                changed = client.put(
                    destination + different_digest, headers=headers, content=b"changed"
                )
                assert changed.json()["code"] == "migration_batch_conflict"
            if service == "director":
                assert [report["record_count"] for report in reports] == [1, 1]
                headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
                source_files = client.get(f"{source}{DIRECTOR_FILES}/{account}", headers=headers)
                assert source_files.status_code == 200, source_files.text
                assert len(source_files.json()) == 2
                entry = source_files.json()[0]
                file_path = f"{DIRECTOR_FILES}/{account}/{entry['scope']}/{entry['sha256']}"
                invalid = client.put(destination + file_path, headers=headers, content=b"partial")
                assert invalid.status_code == 422
                target = client.get(f"{destination}{DIRECTOR_FILES}/{account}", headers=headers)
                assert target.json() == []
                files = transfer_director_files(client, plan, source, destination)
                assert files["record_count"] == 2 and files["byte_count"] > 2 * 1024 * 1024
                assert transfer_director_files(client, plan, source, destination) == files
                # Account paths absent from the plan must be detected even without DB records.
                orphan = (
                    snapshot_db.parent / "accounts" / str(uuid4()) / "applications/director-desk"
                )
                orphan.mkdir(parents=True)
                try:
                    assert client.get(source + DIRECTOR_FILES, headers=headers).status_code == 409
                finally:
                    orphan.rmdir()
                    orphan.parent.rmdir()
                    orphan.parent.parent.rmdir()


def test_stopped_site_reopens_from_verified_runtime_and_original_config(tmp_path):
    runtime = tmp_path / "source/.runtime"
    database = runtime / legacy_snapshot.DATABASE
    runtime.mkdir(parents=True)
    model = runtime / "local-models/fixture/weights.bin"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"isolated local weights")
    (runtime / ".trash").mkdir(mode=0o700)
    (runtime / "fixture-link").symlink_to("local-models/fixture/weights.bin")
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Isolated rollback website</h1>")
    source_port, recovery_port = available_ports()
    key = Fernet.generate_key().decode()
    config = configuration(
        runtime.parent / "backend/config.toml",
        database=database,
        key=key,
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
    snapshot = tmp_path / "snapshot"
    with website(config, source_port) as (client, origin):
        with pytest.raises(ValueError, match="运行实例占用"):
            legacy_snapshot.create(runtime, config, snapshot, REVISION)
        assert not snapshot.exists()
        login = client.post("/v1/auth/login", json={"username": "e2e-admin", "password": PASSWORD})
        assert login.status_code == 200
        account = login.json()["user"]["id"]
        safe = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        cloud = f"\n[cloud_control]\nenabled = true\nadmin_user_ids = [{json.dumps(account)}]\n"
        with config.open("a") as target_config:
            target_config.write(cloud)
        idle = client.put(
            "/v1/cloud-control/desktop/idle", headers=safe, json={"idle_minutes": 12, "revision": 0}
        )
        assert idle.status_code == 200, idle.text
        assert idle.json() == {"idle_minutes": 12, "revision": 1}
        avatar = BytesIO()
        Image.new("RGB", (3, 3), "purple").save(avatar, format="PNG")
        image = avatar.getvalue()
        profile = client.get("/v1/account/profile").json()
        result = client.put(
            AVATAR,
            headers=safe,
            files={"file": ("avatar.png", image, "image/png")},
            data={"expected_revision": profile["revision"]},
        )
        assert result.status_code == 200
        tool = "/v1/tool-navigation/tools/json-formatter"
        assert client.patch(tool, headers=safe, json={"is_favorite": True}).status_code == 200
        assert client.post(tool + "/use", headers=safe).status_code == 200
        state = client.get(TOOLS).json()
        room = client.post(
            "/v1/interview-assistant/rooms",
            headers=safe,
            json={"request_id": "coverage-room", "title": "Pending historical room"},
        )
        assert room.status_code == 201, room.text
        catalog = client.get("/v1/model-providers").json()
        supplier = client.post(
            "/v1/model-suppliers",
            headers=safe,
            json={"name": "Retained supplier", "expected_catalog_revision": catalog["revision"]},
        )
        assert supplier.status_code == 200, supplier.text
        providers = "/v1/model-providers"
        provider = client.post(
            providers,
            headers=safe,
            json={
                "expected_catalog_revision": supplier.json()["revision"],
                "supplier_id": supplier.json()["supplier"]["id"],
                "name": "Retained Models provider",
                "kind": "openai",
                "base_url": "https://provider.example.test/v1",
                "api_key": "fixture-model-credential",
            },
        )
        assert provider.status_code == 200, provider.text
        created_model = client.post(
            f"{providers}/{provider.json()['provider']['id']}/models",
            headers=safe,
            json={
                "expected_catalog_revision": provider.json()["revision"],
                "slug": "isolated-model",
                "label": "Retained model",
                "capabilities": ["chat"],
            },
        )
        assert created_model.status_code == 200, created_model.text
        defaults = client.put(
            "/v1/model-catalog/defaults",
            headers=safe,
            json={
                "expected_revision": created_model.json()["revision"],
                "default_model_ids": {"chat": created_model.json()["model"]["id"]},
            },
        )
        assert defaults.status_code == 200, defaults.text
        quota_path = "/v1/platform/runtime-quotas"
        old_quotas = client.get(quota_path).json()
        quotas = client.patch(
            quota_path,
            headers=safe,
            json={"expected_revision": old_quotas["revision"], "value": old_quotas["value"]},
        )
        assert quotas.status_code == 200, quotas.text
        template_path = "/v1/platform/model-service-templates/user"
        current_template = client.get(template_path).json()
        template = client.put(
            template_path,
            headers=safe,
            json={
                "expected_revision": current_template["revision"],
                "value": {
                    "providers": [
                        {
                            "template_key": "fixture-provider-template",
                            "name": "Retained template",
                            "kind": "openai",
                            "base_url": "https://provider.example.test/v1",
                            "api_key": "fixture-template-secret",
                        }
                    ],
                },
            },
        )
        assert template.status_code == 200, template.text
        demo_path = "/v1/platform/demo-services"
        before_demo = next(
            value for value in client.get(demo_path).json() if value["id"] == "mock_model"
        )
        demo = client.put(
            demo_path + "/mock_model",
            headers=safe,
            json={"expected_revision": before_demo["revision"], "value": {"delay_ms": 5}},
        )
        assert demo.status_code == 200, demo.text
        catalog_before = client.get(providers).json()
        root_folder = client.post(
            "/v1/file-folders", headers=safe, json={"name": "Retained", "scope": "library"}
        )
        assert root_folder.status_code == 200, root_folder.text
        child = client.post(
            "/v1/file-folders",
            headers=safe,
            json={"name": "Nested", "scope": "library", "parent_id": root_folder.json()["id"]},
        )
        assert child.status_code == 200, child.text
        asset_body = b"retained private asset bytes"
        asset = client.post(
            "/v1/files",
            headers=safe,
            data={"folder_id": child.json()["id"]},
            files={"upload": ("retained.txt", asset_body, "text/plain")},
        )
        assert asset.status_code == 200, asset.text
        asset_path = f"/v1/files/{asset.json()['id']}/content"
        director = "/v1/director-desk"
        created = client.post(
            director + "/projects", headers=safe, json={"title": "Retained scene"}
        )
        assert created.status_code == 201, created.text
        project = created.json()
        scene_path = f"{director}/projects/{project['id']}"
        scene_bytes = b"director migration" * 128000
        project_file = client.post(
            scene_path + "/files", headers=safe, files={"upload": ("scene.bin", scene_bytes)}
        )
        assert project_file.status_code == 200, project_file.text
        scene_hash = project_file.json()["key"]
        saved = client.patch(
            scene_path,
            headers=safe,
            json={
                "title": project["title"],
                "document": {**project["document"], "resources": [{"file": scene_hash}]},
                "expected_revision": 0,
            },
        )
        assert saved.status_code == 200 and saved.json()["revision"] == 1
        library = director + "/library/files"
        library_bytes = b"retained motion"
        upload = client.post(library, headers=safe, files={"upload": ("motion.bin", library_bytes)})
        assert upload.status_code == 200, upload.text
        motion_hash = upload.json()["key"]
        motion_path = f"{director}/motions/user-motion:model-{motion_hash}:0"
        motion = {"motion": {"name": "Retained motion"}, "resource": {"file": motion_hash}}
        assert client.put(motion_path, headers=safe, json=motion).status_code == 200
        cookies = dict(client.cookies)

    proof = legacy_snapshot.create(runtime, config, snapshot, REVISION)
    assert proof["files"] >= 8
    assert (snapshot / legacy_snapshot.CONFIG).read_bytes() == config.read_bytes()
    assert (snapshot / ".runtime/fixture-link").is_symlink()
    snapshot_database = snapshot / ".runtime" / legacy_snapshot.DATABASE
    assert legacy_snapshot.digest(snapshot_database) == legacy_snapshot.digest(database)
    migrate_rehearsal(snapshot_database, tmp_path, account, proof["manifest_sha256"])
    assert legacy_snapshot.digest(snapshot_database) == legacy_snapshot.digest(database)
    target = tmp_path / "recovery"
    seal = proof["manifest_sha256"]
    with pytest.raises(ValueError, match="清单摘要"):
        legacy_snapshot.restore(snapshot, target, REVISION, "0" * 64)
    with pytest.raises(ValueError, match="旧站提交版本"):
        legacy_snapshot.restore(snapshot, target, "4" * 40, seal)
    assert not target.exists()
    model.write_bytes(b"isolated simulated source failure")
    assert legacy_snapshot.restore(snapshot, target, REVISION, seal) == proof
    assert (target / ".runtime/fixture-link").read_bytes() == b"isolated local weights"
    assert (target / ".runtime/.trash").is_dir()
    assert model.read_bytes() == b"isolated simulated source failure"
    assert (target / legacy_snapshot.CONFIG).read_bytes() == config.read_bytes()
    restored_key = tomllib.loads((target / legacy_snapshot.CONFIG).read_text())["security"][
        "secrets_key"
    ]
    assert restored_key == key

    # Only the rehearsal listener and data location change in the launch projection.
    launch = configuration(
        target / "backend/rehearsal.toml",
        database=target / ".runtime" / legacy_snapshot.DATABASE,
        key=restored_key,
        port=recovery_port,
        web=web,
    )
    with launch.open("a") as target_config:
        target_config.write(cloud)
    with website(launch, recovery_port) as (restored, _origin):
        restored.cookies.update(cookies)
        assert restored.get("/").status_code == 200
        assert restored.get("/v1/auth/me").json()["user"]["id"] == account
        assert restored.get(TOOLS).json() == state
        status = restored.get("/v1/cloud-control/status").json()
        assert (status["idle_minutes"], status["idle_revision"]) == (12, 1)
        response = restored.get(AVATAR)
        assert response.status_code == 200 and response.content == image
        assert restored.get(asset_path).content == asset_body
        assert restored.get(providers).json() == catalog_before
        assert restored.get(quota_path).json() == quotas.json()
        assert restored.get(template_path).json() == template.json()
        restored_demo = next(
            item for item in restored.get(demo_path).json() if item["id"] == "mock_model"
        )
        assert (restored_demo["revision"], restored_demo["value"]) == (
            demo.json()["revision"],
            demo.json()["value"],
        )
        assert restored.get(scene_path).json() == saved.json()
        assert restored.get(f"{scene_path}/files/{scene_hash}").content == scene_bytes
        assert restored.get(motion_path).json() == motion
        assert restored.get(f"{library}/{motion_hash}").content == library_bytes

    (snapshot / ".runtime/local-models/fixture/weights.bin").write_bytes(b"tampered")
    refused = tmp_path / "must-not-publish"
    with pytest.raises(ValueError, match="快照文件验证失败"):
        legacy_snapshot.restore(snapshot, refused, REVISION, seal)
    assert not refused.exists()
