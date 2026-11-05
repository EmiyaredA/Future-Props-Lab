"""Report sealed migration coverage without returning private record contents."""

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from studio.apps.agent_workbench.migration_shapes import DATASETS as AGENTS
from studio.apps.amadeus.storage.migration_history import DATASETS as AMADEUS
from studio.apps.asset_library.storage.migration_records import DATASETS as ASSETS
from studio.apps.audio_annotation.storage.migration_records import DATASETS as ANNOTATION
from studio.apps.audio_annotation.storage.migration_records import OPERATIONS as ANNOTATION_RECEIPTS
from studio.apps.creative_workshop.storage.migration_catalog import DATASETS as CREATIVE
from studio.apps.director_desk.storage.migration_records import DATASETS as DIRECTOR
from studio.apps.galgame_workshop.storage.migration_records import DATASETS as GALGAME
from studio.apps.galgame_workshop.storage.migration_records import OPERATIONS as GALGAME_RECEIPTS
from studio.apps.identity.credential_migration import DATASETS as IDENTITY
from studio.apps.interview_assistant.storage.migration_records import CREATES as INTERVIEW_CREATES
from studio.apps.interview_assistant.storage.migration_records import DATASETS as INTERVIEW
from studio.apps.model_service.catalog_migration import DATASETS as MODELS
from studio.apps.model_service.settings_migration import DEFAULT_PREFIX, POLICIES
from studio.apps.model_service.storage.migration_history import DATASETS as MODEL_HISTORY
from studio.apps.motion_compositor.storage.migration_records import DATASETS as MOTION
from studio.apps.presentation_workshop.migration_operations import DATASET as PRESENTATION_RECEIPTS
from studio.apps.presentation_workshop.storage.migration_records import DATASETS as PRESENTATION
from studio.apps.remote_desktop.preference_migration import DATASET as REMOTE
from studio.apps.thought_workshop.storage.migration_documents import DATASETS as THOUGHT
from studio.apps.thought_workshop.storage.migration_documents import NOTE_RECEIPTS
from studio.apps.tools.navigation_migration import DATASET as TOOLS
from studio.apps.video_editor.storage.migration_records import DATASETS as VIDEO
from studio.apps.visual_workshop.storage.migration_records import DATASETS as VISUAL
from studio.apps.visual_workshop.storage.migration_records import OPERATIONS as VISUAL_RECEIPTS
from studio.assembly.independent.integrations.maintenance import DATASETS as INTEGRATIONS
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migration_apps import SourceSnapshot

from .legacy_snapshot import (
    CONFIG,
    DATABASE,
    MANIFEST,
    RUNTIME,
    digest,
    directory,
    private_config,
    runtime_inventory,
)

ROOT = Path(__file__).resolve().parents[2]
TRANSFER = {
    **{
        dataset.model.__tablename__: dataset.name
        for dataset in (
            *IDENTITY,
            *ASSETS,
            *DIRECTOR,
            *MODELS,
            *MODEL_HISTORY,
            *PRESENTATION,
            *AGENTS,
            *AMADEUS,
            *INTEGRATIONS,
            *CREATIVE,
        )
    },
    **{
        dataset.model.__tablename__: dataset.name
        for dataset in (*MOTION, *VIDEO, *GALGAME, *VISUAL, *ANNOTATION, *INTERVIEW)
        if dataset is not ANNOTATION_RECEIPTS and dataset is not INTERVIEW_CREATES
    },
    **{
        dataset.orm.__tablename__: dataset.name
        for dataset in THOUGHT
        if dataset is not NOTE_RECEIPTS
    },
    "cloud_desktop_preferences": REMOTE,
    "tool_navigation_items": TOOLS,
    "visual_project_asset_references": "assets.visual-links",
    "presentation_asset_references": "presentation.project-references",
    "presentation_template_assets": "presentation.template-references",
    "presentation_example_assets": "presentation.example-references",
}


REBUILDS = {
    "agent_workbench_search": "agents.search",
    "thought_document_references": "thought.document-relationships",
    "thought_note_assets": "thought.document-relationships",
    "thought_history_assets": "thought.document-relationships",
    "thought_template_assets": "thought.document-relationships",
}


def quoted(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def table_count(database, name):
    return database.execute(f"SELECT COUNT(*) FROM {quoted(name)}").fetchone()[0]


def registered_owners(catalog):
    owners = {}
    for entry in catalog["tables"]:
        table, owner = entry["table"], entry["service"]
        previous = owners.setdefault(table, owner)
        if previous != owner:
            raise ValueError("数据归属清单包含冲突")
    return owners


LEGACY_AGENT_IDS = {"codex", "claude-code", "opencode", "dsh", "pi"}
LEGACY_AGENT_PURPOSES = {"amadeus", "visual_acceptance", "interview_preparation"}
LEGACY_AGENT_SLOTS = {
    f"{agent}:{purpose}" for agent in LEGACY_AGENT_IDS for purpose in LEGACY_AGENT_PURPOSES
}


def retired_agent_grants(payload):
    try:
        value = json.loads(payload)
    except (TypeError, ValueError):
        return False
    if (
        not isinstance(value, dict)
        or value.keys() != {"grants", "managed"}
        or not isinstance(value["grants"], list)
        or not isinstance(value["managed"], list)
    ):
        return False
    for grant in value["grants"]:
        if (
            not isinstance(grant, dict)
            or grant.keys() != {"user_id", "agent_id", "purpose"}
            or not all(isinstance(item, str) for item in grant.values())
            or not 1 <= len(grant["user_id"]) <= 36
            or grant["agent_id"] not in LEGACY_AGENT_IDS
            or grant["purpose"] not in LEGACY_AGENT_PURPOSES
        ):
            return False
    return all(isinstance(slot, str) and slot in LEGACY_AGENT_SLOTS for slot in value["managed"])


def platform_partitions(database, partition, owner_ids):
    def owner(key):
        if key in partition["keys"]:
            return partition["keys"][key]
        return next(
            (
                service
                for prefix, service in partition["prefixes"].items()
                if key.startswith(prefix)
            ),
            "unassigned",
        )

    result, retained = {}, {}
    pending = 0
    for key, old_grants in database.execute(
        "SELECT id, CASE WHEN id = 'code_agents' THEN payload END FROM platform_settings"
    ):
        service = owner(key)
        result[service] = result.get(service, 0) + 1
        if key == "code_agents" and service == "agent-runtime" and retired_agent_grants(old_grants):
            retained[service] = retained.get(service, 0) + 1
        elif service != "models" or (
            key not in POLICIES
            and (
                not key.startswith(DEFAULT_PREFIX)
                or key.removeprefix(DEFAULT_PREFIX) not in owner_ids
            )
        ):
            pending += 1
    return {
        "partitions": result,
        "pending_records": pending,
        "rollback_records": retained,
    }


OPERATION_DATASETS = {
    "presentation": PRESENTATION_RECEIPTS,
    "galgame": GALGAME_RECEIPTS.name,
    "visual": VISUAL_RECEIPTS.name,
    "thought": NOTE_RECEIPTS.name,
    "annotation": ANNOTATION_RECEIPTS.name,
    "interview-create": INTERVIEW_CREATES.name,
}

LAYOUT_JOURNAL = "account_storage_upgrade_roots"


def layout_journal(database, owner_ids):
    rows = database.execute(
        "SELECT owner_user_id, target_relative_root, status, error "
        "FROM account_storage_upgrade_roots"
    )
    pending = conflicts = 0
    for owner, target, status, error in rows:
        pending += status != "completed" or bool(error)
        parts = target.split("/")
        conflicts += (
            owner not in owner_ids
            or parts[0] not in {"accounts", ".trash"}
            or parts[1:2] != [owner]
            or any(part in {"", ".", ".."} for part in parts)
        )
    return {
        "unfinished_records": pending,
        "owner_or_path_conflicts": conflicts,
        "retained_in": "sealed_snapshot",
    }


def operation_partitions(database):
    counts = dict(
        database.execute(
            "SELECT resource_kind, count(*) FROM project_operation_receipts GROUP BY resource_kind"
        )
    )
    return {
        "partitions": counts,
        "pending_records": sum(
            count for kind, count in counts.items() if kind not in OPERATION_DATASETS
        ),
        "datasets": OPERATION_DATASETS,
    }


def coverage(snapshot, catalog, owner_ids):
    snapshot.check()
    owners = registered_owners(catalog)
    derived = catalog["derived_tables"]
    output = []
    with closing(
        sqlite3.connect(snapshot.path.as_uri() + "?mode=ro&immutable=1", uri=True)
    ) as database:
        sources = list(database.execute("PRAGMA table_list"))
        for schema, name, kind, *_ in sorted(sources):
            if schema != "main" or name == "schema_migrations" or name.startswith("sqlite_"):
                continue
            if kind == "view":
                continue
            if kind == "shadow" and any(name.startswith(table + "_") for table in derived):
                continue
            count = table_count(database, name)
            partition = (
                platform_partitions(database, catalog["partitions"][name], owner_ids)
                if name == "platform_settings"
                else None
            )
            if name == "project_operation_receipts":
                partition = operation_partitions(database)
            journal = layout_journal(database, owner_ids) if name == LAYOUT_JOURNAL else None
            if partition is not None and count:
                if partition["pending_records"]:
                    status = "transfer_pending"
                elif sum(partition.get("rollback_records", {}).values()) == count:
                    status = "retained_for_rollback"
                else:
                    status = "dataset_registered"
            elif journal is not None:
                status = (
                    "source_layout_blocked"
                    if journal["unfinished_records"] or journal["owner_or_path_conflicts"]
                    else "retained_for_rollback"
                )
            elif name in TRANSFER:
                status = "dataset_registered"
            elif name in REBUILDS:
                status = "rebuild_registered"
            elif name in derived:
                status = "rebuild_pending"
            elif count:
                status = "transfer_pending" if name in owners else "owner_unassigned"
            else:
                status = "empty"
            item = {
                "table": name,
                "service": derived.get(name, owners.get(name)),
                "record_count": count,
                "status": status,
            }
            if name in TRANSFER:
                item["dataset"] = TRANSFER[name]
            if name in REBUILDS:
                item["dataset"] = REBUILDS[name]
            if partition is not None:
                item.update(partition)
                if partition.get("rollback_records"):
                    item["retained_in"] = "sealed_snapshot"
            if journal is not None:
                item.update(journal)
            output.append(item)
    snapshot.check()
    pending = [
        row["table"]
        for row in output
        if row["status"]
        in {"transfer_pending", "owner_unassigned", "rebuild_pending", "source_layout_blocked"}
    ]
    return {"tables": output, "pending_tables": pending}


def inspect_bundle(bundle, *, plan, manifest_sha256, catalog):
    root = directory(bundle)
    marker = private_config(root / MANIFEST)
    if digest(marker) != manifest_sha256:
        raise ValueError("快照清单摘要不符")
    manifest = json.loads(marker.read_text())
    if manifest["version"] != 1 or manifest["source_revision"] != plan.source_revision:
        raise ValueError("快照来源与迁移计划不匹配")
    if manifest["files"][DATABASE]["sha256"] != plan.source_database_sha256:
        raise ValueError("数据库来源与迁移计划不匹配")
    if digest(private_config(root / CONFIG)) != manifest["config_sha256"]:
        raise ValueError("快照配置摘要不符")
    runtime = directory(root / RUNTIME)
    if runtime_inventory(runtime) != manifest["files"]:
        raise ValueError("快照运行文件与封存清单不一致")
    source = SourceSnapshot(runtime / DATABASE, plan.source_database_sha256)
    result = coverage(source, catalog, {str(owner) for owner in plan.owner_ids})
    return {
        "source_revision": plan.source_revision,
        "source_database_sha256": plan.source_database_sha256,
        "manifest_sha256": manifest_sha256,
        **result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--plan", required=True, type=Path)
    options = parser.parse_args()
    try:
        plan = MigrationPlan.read(options.plan)
        report = inspect_bundle(
            options.snapshot,
            plan=plan,
            manifest_sha256=options.manifest_sha256,
            catalog=json.loads((ROOT / "deploy/contracts/ownership.json").read_text()),
        )
    except (ValueError, OSError, KeyError, TypeError, sqlite3.Error):
        parser.exit(1, "无法核验封存来源或迁移覆盖清单\n")
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    if report["pending_tables"]:
        parser.exit(2)


if __name__ == "__main__":
    main()
