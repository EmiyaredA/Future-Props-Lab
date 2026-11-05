"""Exercise ciphertext transfer against the isolated legacy schema and live CLI."""

import asyncio
import hashlib
import json
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4
from zipfile import ZipFile

import httpx
from cryptography.fernet import Fernet
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_integrations_catalog import transfer_skill_originals
from scripts.website.migration_transfer import pages, project_datasets, transfer
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from tests.test_tools_navigation_migration import available_ports, listener

from app.console.models.accounts import User
from app.integrations.external.models import ExternalConnection
from app.integrations.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from app.integrations.skills.archive import SkillArchiveStorage
from app.integrations.skills.catalog import SkillCatalog
from app.runtime.credentials import SecretCipher
from db.migrations import apply_migrations
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.apps.integrations.storage.service_models import MODELS
from studio.assembly.independent.integrations.maintenance import DATASETS, PREFIX
from studio.contracts.integrations.skill_migration import PREFIX as ORIGINALS
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def create_legacy_catalog(path, owner, cipher):
    apply_migrations(path)
    engine = create_engine(f"sqlite:///{path}")
    try:
        with Session(engine) as session:
            account = str(owner)
            session.add(
                User(
                    id=account,
                    username="fixture-owner",
                    username_normalized="fixture-owner",
                    password_hash="fixture",
                )
            )
            session.flush()
            tool = ToolApiIntegration(
                owner_user_id=account,
                name="Tool",
                method="POST",
                url="https://example.test/tool",
                auth_kind="bearer",
                secret_ciphertext=cipher.encrypt("fixture-tool"),
                sensitive_result=True,
                revision=4,
            )
            mcp = McpIntegration(
                owner_user_id=account,
                name="MCP",
                transport="stdio",
                command="/fixture/mcp",
                arguments=["--fixture"],
                environment_keys=["MCP_TOKEN"],
                environment_ciphertext=cipher.encrypt('{"MCP_TOKEN":"fixture-mcp"}'),
                revision=7,
            )
            external = ExternalConnection(
                owner_user_id=account,
                name="External",
                app_id="fixture-app",
                secret_ciphertext=cipher.encrypt("fixture-external"),
                revision=3,
            )
            skill = SkillIntegration(
                owner_user_id=account,
                name="fixture-skill",
                description="Fixture",
                tags=["test"],
                default_version="v1",
                latest_version="v2",
                enabled=True,
                revision=5,
            )
            session.add_all((tool, mcp, external, skill))
            session.flush()
            session.add_all(
                (
                    McpDiscoveredTool(server_id=mcp.id, name="fixture-discovered-tool"),
                    IntegrationCheck(
                        owner_user_id=account,
                        resource_kind="tool_api",
                        resource_id=tool.id,
                        resource_name=tool.name,
                        ok=True,
                        status_code=200,
                        latency_ms=14,
                    ),
                )
            )
            archive = {
                "SKILL.md": b"---\nname: fixture-skill\ndescription: Fixture\n---\n",
                "assets/empty.txt": b"",
                "notes/笔记.txt": b"owned document",
            }
            for version in ("v1", "v2"):
                root = (
                    path.parent
                    / "accounts"
                    / account
                    / "integrations"
                    / "skills"
                    / skill.id
                    / version
                )
                for member, content in archive.items():
                    target = root / member
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                session.add(
                    SkillVersion(
                        skill_id=skill.id,
                        version=version,
                        name="fixture-skill",
                        description="Fixture",
                        storage_path="/retired/site/path",
                        content_sha256="1" * 64,
                        file_count=len(archive),
                        expanded_bytes=sum(map(len, archive.values())),
                    )
                )
            ids = tool.id, mcp.id, external.id, skill.id, archive
            session.commit()
        return ids
    finally:
        engine.dispose()


def test_integrations_catalog_uses_original_key_and_replays_receipts(tmp_path):
    key = Fernet.generate_key().decode("ascii")
    cipher = SecretCipher(key)
    owner, other = uuid4(), uuid4()
    source_db = tmp_path / "legacy.sqlite"
    tool_id, mcp_id, external_id, skill_id, archive = create_legacy_catalog(
        source_db, owner, cipher
    )
    target_dir = tmp_path / "integrations"
    apply(target_dir / "service.db", "integrations", MIGRATIONS)
    token = "integrations-isolated-migration-fixture-authority"
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="a" * 40,
        source_database_sha256=digest(source_db),
        owner_ids=(owner, other),
        token=token,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.touch(mode=0o600)
    plan_path.write_text(json.dumps({**plan.model_dump(mode="json"), "token": token}))
    config = tmp_path / "integrations.toml"
    config.touch(mode=0o600)

    def configure(value):
        config.write_text(
            "[storage]\ndatabase_path = "
            + json.dumps(str(target_dir / "service.db"))
            + "\n[security]\nsecrets_key = "
            + json.dumps(value)
            + "\n"
        )

    datasets = project_datasets(PREFIX, DATASETS)
    tools, servers, mcp_tools, external, _checks, skills, versions = datasets
    source_port, target_port = available_ports()
    headers = {"X-Fpl-Migration-Token": token}
    module = "studio.assembly.independent.integrations.cli"

    def open_target(client):
        return listener(
            client,
            target_port,
            "migration-import",
            plan_path,
            "--state-root",
            target_dir,
            "--config",
            config,
            module=module,
            prefix=tools.prefix,
        )

    def rows(client, url, dataset):
        return [
            record
            for page in pages(client, url, headers, plan, owner, dataset)
            for record in page.batch.records
        ]

    with (
        httpx.Client(timeout=15, trust_env=False) as client,
        listener(
            client,
            source_port,
            "migration-export",
            plan_path,
            "--legacy-db",
            source_db,
            module=module,
            prefix=tools.prefix,
        ) as source,
    ):
        configure(Fernet.generate_key().decode("ascii"))
        with open_target(client) as target:
            page = next(pages(client, source, headers, plan, owner, tools))
            denied = client.post(
                target + tools.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": page.sha256},
                json=page.batch.model_dump(mode="json"),
            )
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_integration_credential_unreadable"
            assert not rows(client, target, tools)
        configure(key)
        with open_target(client) as target:
            assert transfer(client, plan, source, target, tools)["record_count"] == 1
            for dataset in (skills, versions):
                transfer(client, plan, source, target, dataset)
            route = f"{ORIGINALS}/{owner}/{skill_id}/v1"
            file = {
                "path": "assets/empty.txt",
                "size": 0,
                "sha256": hashlib.sha256(b"").hexdigest(),
            }
            rejected = client.put(
                target + route + "/file", headers=headers, params=file, content=b"x"
            )
            assert rejected.status_code == 409
            named = "notes/笔记.txt"
            intended = archive[named]
            wrong = client.put(
                target + route + "/file",
                headers=headers,
                params={
                    "path": named,
                    "size": len(intended),
                    "sha256": hashlib.sha256(intended).hexdigest(),
                },
                content=b"!" * len(intended),
            )
            assert wrong.status_code == 409
            assert wrong.json()["code"] == "migration_skill_file_bytes_changed"
            accepted = client.put(
                target + route + "/file", headers=headers, params=file, content=b""
            )
            accepted.raise_for_status()
            empty_receipt = accepted.json()
            escape = client.put(
                target + route + "/file",
                headers=headers,
                params={**file, "path": "../escaped.txt"},
                content=b"",
            )
            assert escape.status_code == 409
            assert not (
                target_dir
                / "accounts"
                / str(owner)
                / "integrations"
                / "skills"
                / skill_id
                / "escaped.txt"
            ).exists()
            incomplete = client.get(
                target + route + "/inventory", headers=headers, params={"complete": True}
            )
            assert incomplete.status_code == 409
            denied = client.put(
                target + f"{ORIGINALS}/{other}/{skill_id}/v1/file",
                headers=headers,
                params=file,
                content=b"",
            )
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_skill_version_unavailable"
        with open_target(client) as target:
            reports = [transfer(client, plan, source, target, dataset) for dataset in datasets]
            assert [report["record_count"] for report in reports] == [1, 1, 1, 1, 1, 1, 2]
            assert [transfer(client, plan, source, target, ds) for ds in datasets] == reports
            migrated = transfer_skill_originals(client, plan, source, target)
            assert migrated["record_count"] == 6
            assert migrated["byte_count"] == 2 * sum(map(len, archive.values()))
            assert transfer_skill_originals(client, plan, source, target) == migrated
            replayed = client.put(
                target + route + "/file", headers=headers, params=file, content=b""
            )
            assert replayed.json() == empty_receipt
            for version in ("v1", "v2"):
                restored = (
                    target_dir
                    / "accounts"
                    / str(owner)
                    / "integrations"
                    / "skills"
                    / skill_id
                    / version
                )
                assert {
                    p.relative_to(restored).as_posix(): p.read_bytes()
                    for p in restored.rglob("*")
                    if p.is_file()
                } == archive
            assert all(row.content_sha256 == "1" * 64 for row in rows(client, target, versions))
            extra = restored / "unexpected.txt"
            extra.write_bytes(b"not in the source")
            conflicted = client.get(
                target + f"{ORIGINALS}/{owner}/{skill_id}/v2/inventory",
                headers=headers,
                params={"complete": True},
            )
            assert conflicted.status_code == 409
            assert conflicted.json()["code"] == "migration_skill_file_inventory_conflict"
            extra.unlink()
            (tool,) = rows(client, target, tools)
            (server,) = rows(client, target, servers)
            (connection,) = rows(client, target, external)
            (discovered,) = rows(client, target, mcp_tools)
            assert (tool.id, server.id, connection.id) == (tool_id, mcp_id, external_id)
            assert (tool.revision, server.revision, connection.revision) == (4, 7, 3)
            assert cipher.decrypt(tool.secret_ciphertext) == "fixture-tool"
            assert json.loads(cipher.decrypt(server.environment_ciphertext)) == {
                "MCP_TOKEN": "fixture-mcp"
            }
            assert cipher.decrypt(connection.secret_ciphertext) == "fixture-external"
            assert discovered.server_id == mcp_id
            originals = next(pages(client, source, headers, plan, owner, mcp_tools)).batch
            wrong_owner = originals.model_copy(update={"owner_id": other, "batch_id": uuid4()})
            denied = client.post(
                target + mcp_tools.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": wrong_owner.digest},
                json=wrong_owner.model_dump(mode="json"),
            )
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_project_owner_conflict"
            assert not next(pages(client, target, headers, plan, other, mcp_tools)).batch.records

    async def check_business_download():
        database = Database("integrations", target_dir, models=MODELS)
        try:
            async with database.sessions(info={"owner_user_id": str(owner)}) as session:
                storage = SkillArchiveStorage(SimpleNamespace(runtime_path=target_dir), str(owner))
                catalog = SkillCatalog(session, str(owner), storage=storage)
                item = await catalog.get(skill_id)
                assert (item.default_version, item.latest_version, item.revision) == ("v1", "v2", 5)
                for version in ("v1", "v2"):
                    _filename, body = await catalog.version_zip(skill_id, version)
                    with ZipFile(BytesIO(body)) as package:
                        assert {name: package.read(name) for name in package.namelist()} == archive
        finally:
            await database.close()

    asyncio.run(check_business_download())
