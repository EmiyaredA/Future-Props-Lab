"""Generate one private migration plan from the complete sealed account inventory."""

import argparse
import json
import os
import secrets
import sqlite3
import tempfile
from pathlib import Path
from uuid import uuid4

from studio.contracts.management.migration_batches import MigrationPlan

from .legacy_snapshot import DATABASE, directory
from .migration_coverage import source_owners, verified_source


def prepare_plan(snapshot, seal, output):
    root = directory(snapshot)
    parent = directory(output.parent)
    target = parent / output.name
    if target.is_relative_to(root):
        raise ValueError("迁移计划必须保存在封存目录外")
    if target.exists() or target.is_symlink():
        raise ValueError("迁移计划已存在，应沿用原计划继续")
    source, manifest = verified_source(root, seal)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=manifest["source_revision"],
        source_database_sha256=manifest["files"][DATABASE]["sha256"],
        owner_ids=source_owners(source),
        token=secrets.token_urlsafe(48),
    )
    descriptor, staged = tempfile.mkstemp(prefix=".migration-plan-", dir=parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            data = plan.model_dump(mode="json", exclude={"token"})
            data["token"] = plan.token.get_secret_value()
            json.dump(data, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        # A racing invocation must keep the original plan and its replay identities.
        os.link(staged, target)
    finally:
        Path(staged).unlink(missing_ok=True)
    fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return {
        "plan": str(target),
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "owner_count": len(plan.owner_ids),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    try:
        report = prepare_plan(options.snapshot, options.manifest_sha256, options.output)
    except (ValueError, OSError, KeyError, TypeError, sqlite3.Error):
        parser.exit(1, "无法从封存来源生成计划，请核对快照、账号与输出路径\n")
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
