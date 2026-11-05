"""List migration coverage against the sealed source schema without reading private records."""

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from fpl_agents.migration_shapes import DATASETS as AGENTS
from fpl_assets.migration_records import DATASETS as ASSETS
from fpl_director.migration_records import DATASETS as DIRECTOR
from fpl_galgame.migration_records import DATASETS as GALGAME
from fpl_galgame.migration_records import OPERATIONS as GALGAME_RECEIPTS
from fpl_identity.credential_migration import DATASETS as IDENTITY
from fpl_models.catalog_migration import DATASETS as MODELS
from fpl_models.settings_migration import DEFAULT_PREFIX, POLICIES
from fpl_motion.migration_records import DATASETS as MOTION
from fpl_presentation.migration_operations import DATASET as PRESENTATION_RECEIPTS
from fpl_presentation.migration_records import DATASETS as PRESENTATION
from fpl_remote.preference_migration import DATASET as REMOTE
from fpl_runtime.migration_apps import SourceSnapshot
from fpl_runtime.migration_batches import MigrationPlan
from fpl_tools.navigation_migration import DATASET as TOOLS
from fpl_video.migration_records import DATASETS as VIDEO
from fpl_visual.migration_records import DATASETS as VISUAL
from fpl_visual.migration_records import OPERATIONS as VISUAL_RECEIPTS

from .legacy_snapshot import CONFIG, DATABASE, MANIFEST, RUNTIME, digest, directory, private_config

ROOT = Path(__file__).resolve().parents[2]
TRANSFER = {
    **{
        dataset.model.__tablename__: dataset.name
        for dataset in (*IDENTITY, *ASSETS, *DIRECTOR, *MODELS, *PRESENTATION, *AGENTS)
    },
    **{
        dataset.model.__tablename__: dataset.name
        for dataset in (*MOTION, *VIDEO, *GALGAME, *VISUAL)
    },
    "cloud_desktop_preferences": REMOTE,
    "tool_navigation_items": TOOLS,
    "visual_project_asset_references": "assets.visual-links",
    "presentation_asset_references": "presentation.project-references",
    "presentation_template_assets": "presentation.template-references",
    "presentation_example_assets": "presentation.example-references",
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


def platform_partitions(database, partition):
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

    result = {}
    pending = 0
    for key, count in database.execute("SELECT id, count(*) FROM platform_settings GROUP BY id"):
        service = owner(key)
        result[service] = result.get(service, 0) + count
        if service != "models" or (key not in POLICIES and not key.startswith(DEFAULT_PREFIX)):
            pending += count
    return result, pending


OPERATION_DATASETS = {
    "presentation": PRESENTATION_RECEIPTS,
    "galgame": GALGAME_RECEIPTS.name,
    "visual": VISUAL_RECEIPTS.name,
}


def operation_partitions(database):
    counts = dict(
        database.execute(
            "SELECT resource_kind, count(*) FROM project_operation_receipts GROUP BY resource_kind"
        )
    )
    return counts, sum(count for kind, count in counts.items() if kind not in OPERATION_DATASETS)


def coverage(snapshot, catalog):
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
                platform_partitions(database, catalog["partitions"][name])
                if name == "platform_settings"
                else None
            )
            if name == "project_operation_receipts":
                partition = operation_partitions(database)
            if partition is not None and count:
                status = "transfer_pending" if partition[1] else "dataset_registered"
            elif name in TRANSFER:
                status = "dataset_registered"
            elif name == "agent_workbench_search":
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
            if partition is not None:
                item["partitions"], item["pending_records"] = partition
                if name == "project_operation_receipts":
                    item["datasets"] = OPERATION_DATASETS
            output.append(item)
    snapshot.check()
    pending = [
        row["table"]
        for row in output
        if row["status"] in {"transfer_pending", "owner_unassigned", "rebuild_pending"}
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
    source = SourceSnapshot(directory(root / RUNTIME) / DATABASE, plan.source_database_sha256)
    result = coverage(source, catalog)
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
