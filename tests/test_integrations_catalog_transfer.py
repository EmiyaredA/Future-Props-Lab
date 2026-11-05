"""Exercise ciphertext transfer against the isolated legacy schema and live CLI."""

import json
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from scripts.website.legacy_snapshot import digest
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
    ToolApiIntegration,
)
from app.runtime.credentials import SecretCipher
from db.migrations import apply_migrations
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.integrations.maintenance import DATASETS, PREFIX
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply


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
            session.add_all((tool, mcp, external))
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
            ids = tool.id, mcp.id, external.id
            session.commit()
        return ids
    finally:
        engine.dispose()


def test_integrations_catalog_uses_original_key_and_replays_receipts(tmp_path):
    key = Fernet.generate_key().decode("ascii")
    cipher = SecretCipher(key)
    owner, other = uuid4(), uuid4()
    source_db = tmp_path / "legacy.sqlite"
    tool_id, mcp_id, external_id = create_legacy_catalog(source_db, owner, cipher)
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
    tools, servers, mcp_tools, external, _checks = datasets
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
        with open_target(client) as target:
            reports = [transfer(client, plan, source, target, dataset) for dataset in datasets]
            assert [report["record_count"] for report in reports] == [1, 1, 1, 1, 1]
            assert [transfer(client, plan, source, target, ds) for ds in datasets] == reports
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
