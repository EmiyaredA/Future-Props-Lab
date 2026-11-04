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
from scripts.website.migrate_identity import CREDENTIALS
from scripts.website.migrate_identity_avatars import transfer_avatars
from scripts.website.migrate_tools_navigation import NAVIGATION
from scripts.website.migration_transfer import transfer
from tests.test_tools_navigation_migration import available_ports, listener

from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
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


def migrate_rehearsal(snapshot_db, parent, account):
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
    for service, migrations, datasets in (
        ("identity", IDENTITY_MIGRATIONS, CREDENTIALS),
        ("tools", TOOLS_MIGRATIONS, (NAVIGATION,)),
    ):
        root = parent / f"independent-{service}"
        apply(root / "service.db", service, migrations)
        source_port, target_port = available_ports()
        settings = {"module": f"fpl_{service}", "prefix": datasets[0].prefix}
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
                **settings,
            ) as destination,
        ):
            reports = [transfer(client, plan, source, destination, item) for item in datasets]
            assert reports[0]["record_count"] == 1
            assert reports == [
                transfer(client, plan, source, destination, item) for item in datasets
            ]
            if service == "identity":
                assert transfer_avatars(client, plan, source, destination)["record_count"] == 1


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
        cookies = dict(client.cookies)

    proof = legacy_snapshot.create(runtime, config, snapshot, REVISION)
    assert proof["files"] >= 8
    assert (snapshot / legacy_snapshot.CONFIG).read_bytes() == config.read_bytes()
    assert (snapshot / ".runtime/fixture-link").is_symlink()
    snapshot_database = snapshot / ".runtime" / legacy_snapshot.DATABASE
    assert legacy_snapshot.digest(snapshot_database) == legacy_snapshot.digest(database)
    migrate_rehearsal(snapshot_database, tmp_path, account)
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
    with website(launch, recovery_port) as (restored, _origin):
        restored.cookies.update(cookies)
        assert restored.get("/").status_code == 200
        assert restored.get("/v1/auth/me").json()["user"]["id"] == account
        assert restored.get(TOOLS).json() == state
        response = restored.get(AVATAR)
        assert response.status_code == 200 and response.content == image

    (snapshot / ".runtime/local-models/fixture/weights.bin").write_bytes(b"tampered")
    refused = tmp_path / "must-not-publish"
    with pytest.raises(ValueError, match="快照文件验证失败"):
        legacy_snapshot.restore(snapshot, refused, REVISION, seal)
    assert not refused.exists()
