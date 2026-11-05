import asyncio
import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_creative_catalog import transfer_creative_originals
from scripts.website.migrate_creative_installations import INSTALLATIONS, bind_original_resources
from scripts.website.migration_transfer import pages, project_datasets, transfer
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from tests.test_creative_integration_installations import granted
from tests.test_tools_navigation_migration import available_ports, listener

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from db.migrations import apply_migrations
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migration_catalog import DATASETS
from studio.apps.creative_workshop.storage.migration_originals import PREFIX as ORIGINALS
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.creative_workshop.storage.stdio_records import record_setup
from studio.apps.identity.storage.models.accounts import User
from studio.apps.integrations.creative_installations import CreativeInstallations
from studio.apps.integrations.storage.creative_records import CreativeInstallReceipt
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.apps.integrations.storage.models import McpIntegration, ToolApiIntegration
from studio.apps.integrations.storage.service_models import MODELS as INTEGRATION_MODELS
from studio.assembly.independent.creative_workshop.maintenance import PREFIX, RELATIONSHIPS
from studio.assembly.independent.integrations.maintenance import DATASETS as INTEGRATIONS_DATASETS
from studio.assembly.independent.integrations.maintenance import PREFIX as INTEGRATIONS_PREFIX
from studio.contracts.creative_workshop.creative_integrations import CreativeStdioConfiguration
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def legacy_catalog(path, owner, author, installer):
    apply_migrations(path)
    engine = create_engine(f"sqlite:///{path}")
    try:
        with Session(engine) as db:
            for identifier, name in (
                (owner, "owner"),
                (author, "author"),
                (installer, "installer"),
            ):
                db.add(
                    User(
                        id=str(identifier),
                        username=name,
                        username_normalized=name,
                        password_hash="isolated-fixture",
                    )
                )
            db.flush()
            root, release = str(uuid4()), str(uuid4())
            cover = "creative-workshop/covers/" + uuid4().hex + ".webp"
            draft = f"creative-workshop/skill-drafts/{root}/{uuid4().hex}"
            frozen = f"creative-workshop/skill-releases/{release}"
            contents = {"SKILL.md": b"fixture skill", "nested/空.txt": b""}
            files = {cover: b"cover bytes"} | {
                directory + "/" + name: data
                for directory in (draft, frozen)
                for name, data in contents.items()
            }
            for relative, data in files.items():
                member = path.parent / "accounts" / str(owner) / relative
                member.parent.mkdir(parents=True, exist_ok=True)
                member.write_bytes(data)
            manifest = {
                "file_count": len(contents),
                "expanded_bytes": sum(map(len, contents.values())),
            }
            db.add(
                CreativeItem(
                    id=root,
                    origin_owner_user_id=str(owner),
                    author_user_id=str(author),
                    kind="skill",
                    title="Published fixture",
                    status="published",
                    current_release_id=release,
                    revision=5,
                    draft_cover_path=cover,
                    draft_skill_path=draft,
                    draft_manifest=manifest,
                )
            )
            db.flush()
            db.add(
                CreativeRelease(
                    id=release,
                    item_id=root,
                    version=1,
                    title="Frozen fixture",
                    manifest=manifest,
                    cover_path=cover,
                    skill_path=frozen,
                )
            )
            db.flush()
            db.add(
                CreativeInstallation(
                    owner_user_id=str(installer),
                    installed_by_user_id=str(installer),
                    release_id=release,
                    resources=[
                        {"release_id": release, "kind": "skill", "resource_id": str(uuid4())}
                    ],
                )
            )
            db.commit()
        return root, release, files
    finally:
        engine.dispose()


def test_creative_history_keeps_original_author_and_installing_account(tmp_path):
    owner, author, installer = uuid4(), uuid4(), uuid4()
    source_db = tmp_path / "legacy.sqlite"
    item_id, release_id, files = legacy_catalog(source_db, owner, author, installer)
    target_dir = tmp_path / "creative"
    apply(target_dir / "service.db", "creative", MIGRATIONS)
    token = "creative-isolated-catalog-fixture-token"
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="b" * 40,
        source_database_sha256=digest(source_db),
        owner_ids=(owner, author, installer),
        token=token,
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(json.dumps({**plan.model_dump(mode="json"), "token": token}))
    items, releases, installations = project_datasets(PREFIX, DATASETS)
    headers = {"X-Fpl-Migration-Token": token}
    source_port, target_port = available_ports()
    module = "studio.assembly.independent.creative_workshop.cli"

    def open_target(client):
        return listener(
            client,
            target_port,
            "migration-import",
            plan_file,
            "--state-root",
            target_dir,
            module=module,
            prefix=items.prefix,
        )

    with (
        httpx.Client(timeout=15, trust_env=False) as client,
        listener(
            client,
            source_port,
            "migration-export",
            plan_file,
            "--legacy-db",
            source_db,
            module=module,
            prefix=items.prefix,
        ) as source,
    ):
        with open_target(client) as target:
            assert transfer(client, plan, source, target, items)["record_count"] == 1
            publication = next(pages(client, source, headers, plan, owner, releases)).batch
            invalid = publication.model_copy(update={"owner_id": installer, "batch_id": uuid4()})
            denied = client.post(
                target + releases.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": invalid.digest},
                json=invalid.model_dump(mode="json"),
            )
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_project_owner_conflict"
            transfer(client, plan, source, target, releases)
            cover, body = next(iter(files.items()))
            params = {"path": cover, "size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            target_file = f"{ORIGINALS}/{owner}/file"
            wrong = client.put(
                target + target_file, params=params, headers=headers, content=b"x" * len(body)
            )
            assert wrong.status_code == 409
            denied = client.put(
                target + f"{ORIGINALS}/{installer}/file",
                params=params,
                headers=headers,
                content=body,
            )
            assert denied.status_code == 409
            accepted = client.put(
                target + target_file, params=params, headers=headers, content=body
            )
            accepted.raise_for_status()
            early_receipt = accepted.json()
        with open_target(client) as target:
            reports = [
                transfer(client, plan, source, target, ds)
                for ds in (items, releases, installations)
            ]
            assert [report["record_count"] for report in reports] == [1, 1, 1]
            result = transfer_creative_originals(client, plan, source, target)
            assert result["record_count"] == len(files) and result["byte_count"] == sum(
                map(len, files.values())
            )
            assert transfer_creative_originals(client, plan, source, target) == result
            assert (
                client.put(
                    target + target_file, params=params, headers=headers, content=body
                ).json()
                == early_receipt
            )
            root = target_dir / "accounts" / str(owner)
            assert {
                p.relative_to(root).as_posix(): p.read_bytes()
                for p in root.rglob("*")
                if p.is_file()
            } == files
            (item,) = next(pages(client, target, headers, plan, owner, items)).batch.records
            assert (item.id, item.author_user_id, item.current_release_id, item.revision) == (
                item_id,
                str(author),
                release_id,
                5,
            )
            assert not next(pages(client, target, headers, plan, installer, items)).batch.records
            (installation,) = next(
                pages(client, target, headers, plan, installer, installations)
            ).batch.records
            assert (
                installation.release_id == release_id
                and installation.installed_by_user_id == str(installer)
            )
            for address in (source, target):
                audit = client.get(address + RELATIONSHIPS, headers=headers)
                audit.raise_for_status()
                assert audit.json() == {"record_count": 1}


def legacy_installation(path, owner, installer, *, mirror, deleted):
    """An installed tool plus an unconfigured stdio MCP in a historical bundle."""
    apply_migrations(path)
    engine = create_engine(f"sqlite:///{path}")
    try:
        with Session(engine) as db:
            for identifier, name in ((owner, "publisher"), (installer, "installer")):
                db.add(
                    User(
                        id=str(identifier),
                        username=name,
                        username_normalized=name,
                        password_hash="isolated-fixture",
                    )
                )
            tool = ToolApiIntegration(
                id=str(uuid4()),
                owner_user_id=str(installer),
                name="Installed Tool",
                method="GET",
                url="https://example.test/tool",
                enabled=False,
            )
            if not deleted:
                db.add(tool)
            db.flush()

            def publish(kind, title, manifest, *, components=None):
                item = CreativeItem(
                    origin_owner_user_id=str(owner),
                    author_user_id=str(owner),
                    kind=kind,
                    status="published",
                    title=title,
                )
                db.add(item)
                db.flush()
                release = CreativeRelease(
                    item_id=item.id,
                    version=1,
                    title=title,
                    summary="Legacy summary",
                    tags=["fixture"],
                    manifest=manifest,
                    components=components or [],
                )
                db.add(release)
                db.flush()
                item.current_release_id = release.id
                return release

            tool_release = publish("tool_api", "Tool", {"method": "GET", "url": tool.url})
            mcp_release = publish("mcp", "MCP", {"transport": "stdio"})
            bundle = publish("bundle", "Bundle", {}, components=[tool_release.id, mcp_release.id])
            tool_part = {
                "release_id": tool_release.id,
                "kind": "tool_api",
                "name": tool.name,
                "state": "disabled",
                "resource_id": tool.id,
            }
            mcp_part = {
                "release_id": mcp_release.id,
                "kind": "mcp",
                "name": "Installed MCP",
                "state": "pending_setup",
                "resource_id": "",
            }
            for release, parts in (
                (tool_release, [tool_part]),
                (mcp_release, [mcp_part]),
                (
                    bundle,
                    [tool_part, {**mcp_part, "name": mcp_part["name"] if mirror else "Wrong"}],
                ),
            ):
                installation = CreativeInstallation(
                    owner_user_id=str(installer),
                    installed_by_user_id=str(installer),
                    release_id=release.id,
                    resources=parts,
                )
                db.add(installation)
            db.flush()
            values = (bundle.id, installation.id, tool_part, mcp_part)
            db.commit()
            return values
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("mirror", "deleted"),
    [(True, False), (False, False), (True, True)],
    ids=["replay", "conflicting-mirror", "deleted-in-source"],
)
def test_legacy_creative_stdio_setup_recovers_original_installation_after_migration(
    tmp_path, mirror, deleted
):
    owner, installer = uuid4(), uuid4()
    source_db = tmp_path / "legacy.sqlite"
    bundle_release, bundle_installation, tool, mcp = legacy_installation(
        source_db, owner, installer, mirror=mirror, deleted=deleted
    )
    creative_dir, integration_dir = tmp_path / "creative", tmp_path / "integrations"
    apply(creative_dir / "service.db", "creative", MIGRATIONS)
    apply(integration_dir / "service.db", "integrations", INTEGRATION_MIGRATIONS)
    token = "creative-isolated-installation-fixture-token"
    key = Fernet.generate_key().decode()
    config = tmp_path / "integrations.toml"
    config.touch(mode=0o600)
    config.write_text(
        "[storage]\ndatabase_path = "
        + json.dumps(str(integration_dir / "service.db"))
        + "\n[security]\nsecrets_key = "
        + json.dumps(key)
        + "\n"
    )
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="b" * 40,
        source_database_sha256=digest(source_db),
        owner_ids=(owner, installer),
        token=token,
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(json.dumps({**plan.model_dump(mode="json"), "token": token}))
    headers = {"X-Fpl-Migration-Token": token}
    items, *creative_sets = project_datasets(PREFIX, DATASETS)
    (tool_set, *_) = project_datasets(INTEGRATIONS_PREFIX, INTEGRATIONS_DATASETS)
    c_export_port, c_import_port = available_ports()
    i_export_port, i_import_port = available_ports()

    def creative_listener(client, port, command, option, value):
        return listener(
            client,
            port,
            command,
            plan_file,
            option,
            value,
            module="studio.assembly.independent.creative_workshop.cli",
            prefix=items.prefix,
        )

    def integrations_listener(client, port, command, option, value):
        return listener(
            client,
            port,
            command,
            plan_file,
            option,
            value,
            "--config",
            config,
            module="studio.assembly.independent.integrations.cli",
            prefix=tool_set.prefix,
        )

    with (
        httpx.Client(timeout=20, trust_env=False) as client,
        creative_listener(
            client, c_export_port, "migration-export", "--legacy-db", source_db
        ) as legacy,
        creative_listener(
            client, c_import_port, "migration-import", "--state-root", creative_dir
        ) as creative,
    ):
        for dataset in (items, *creative_sets):
            assert transfer(client, plan, legacy, creative, dataset)["record_count"] == 3
        assert transfer_creative_originals(client, plan, legacy, creative)["record_count"] == 0
        if not mirror:
            rejected = client.get(creative + INSTALLATIONS.prefix + "/inventory", headers=headers)
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_creative_install_bundle_conflict"
            return
        page = next(pages(client, creative, headers, plan, installer, INSTALLATIONS))
        assert {record.release_id for record in page.batch.records} == {
            tool["release_id"],
            mcp["release_id"],
        }

        def upload(target, batch):
            return client.post(
                target + INSTALLATIONS.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": batch.digest},
                json=batch.model_dump(mode="json"),
            )

        with integrations_listener(
            client, i_export_port, "migration-export", "--legacy-db", source_db
        ) as source:
            bound = bind_original_resources(client, plan, source)
            verified = next(bound(installer, iter([page])))
            recorded_tool = next(r for r in verified.batch.records if r.result.kind == "tool_api")
            assert recorded_tool.resource_present is not deleted
            with integrations_listener(
                client, i_import_port, "migration-import", "--state-root", integration_dir
            ) as target:
                assert upload(target, page.batch).json()["code"] == (
                    "migration_creative_source_resource_unverified"
                )
                if not deleted:
                    assert upload(target, verified.batch).json()["code"] == (
                        "migration_creative_installed_resource_presence_changed"
                    )
                assert not next(
                    pages(client, target, headers, plan, installer, INSTALLATIONS)
                ).batch.records
                assert transfer(client, plan, source, target, tool_set)["record_count"] == int(
                    not deleted
                )
                if not deleted:
                    wrong_owner = verified.batch.model_copy(
                        update={"owner_id": owner, "batch_id": uuid4()}
                    )
                    assert upload(target, wrong_owner).json()["code"] == (
                        "migration_creative_installed_resource_owner_conflict"
                    )
                    with pytest.raises(httpx.HTTPStatusError) as denied:
                        next(bound(owner, iter([page])))
                    assert denied.value.response.json()["code"] == (
                        "migration_creative_installed_resource_owner_conflict"
                    )
                result = transfer(client, plan, creative, target, INSTALLATIONS, source_pages=bound)
                assert result["record_count"] == 2
            with integrations_listener(
                client, i_import_port, "migration-import", "--state-root", integration_dir
            ) as target:
                assert (
                    transfer(client, plan, creative, target, INSTALLATIONS, source_pages=bound)
                    == result
                )
                restored = next(pages(client, target, headers, plan, installer, INSTALLATIONS))
                assert restored == verified

    async def configure_original_installation():
        creative = creative_database(creative_dir)
        integrations = Database("integrations", integration_dir, models=INTEGRATION_MODELS)
        settings = SimpleNamespace(fpl_secrets_key=key)
        try:
            assert [
                entry["release_id"]
                for entry in (
                    await original_installation(creative, installer, bundle_installation)
                ).resources
            ] == [tool["release_id"], mcp["release_id"]]

            body = CreativeStdioConfiguration(
                release_id=mcp["release_id"],
                command="/fixture/mcp",
                arguments=["serve"],
                environment={"FIXTURE_TOKEN": "fixture-value"},
            )
            use = CreativeInstallations(integrations, settings)
            with pytest.raises(HTTPException) as denied:
                await use.configure_stdio(body, granted(body, "setup", str(owner)))
            assert denied.value.status_code == 404
            receipt = await use.configure_stdio(body, granted(body, "setup", str(installer)))
            await integrations.close()
            # Recover from a lost response with a fresh runtime and the same payload.
            use = CreativeInstallations(integrations, settings)
            assert (
                await use.configure_stdio(body, granted(body, "setup", str(installer))) == receipt
            )
            configured = await record_setup(
                creative, str(installer), bundle_installation, body.release_id, receipt
            )
            assert configured.release_id == bundle_release
            assert configured.resources == [tool, receipt]
            async with creative.sessions(info={"owner_user_id": str(installer)}) as db:
                mirrored = await db.scalar(
                    select(CreativeInstallation).where(
                        CreativeInstallation.release_id == body.release_id
                    )
                )
                assert mirrored.resources == [receipt]
            async with integrations.sessions(info={"owner_user_id": str(installer)}) as db:
                server = await db.get(McpIntegration, receipt["resource_id"])
                assert not server.enabled and server.owner_user_id == str(installer)
                assert (
                    json.loads(use.cipher.decrypt(server.environment_ciphertext))
                    == body.environment
                )
                assert not await db.scalar(select(CreativeInstallReceipt))
        finally:
            await creative.close()
            await integrations.close()

    asyncio.run(configure_original_installation())


async def original_installation(database, owner, identifier):
    async with database.sessions(info={"owner_user_id": str(owner)}) as db:
        return await db.get(CreativeInstallation, identifier)
