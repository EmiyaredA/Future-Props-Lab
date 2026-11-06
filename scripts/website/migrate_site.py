"""Run the sealed website transfer through every owner's maintenance API."""

import argparse
import fcntl
import json
import os
import sqlite3
import stat
import subprocess
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit

from studio.contracts.management.migration_batches import MigrationPlan
from studio.contracts.presentation_workshop.presentation_migration import REFERENCE_DATASETS

from .legacy_snapshot import directory, private_config
from .migration_coverage import ROOT, inspect_bundle
from .migration_transfer import loopback


def pair(owner):
    return {"source": f"{owner}-source", "target": f"{owner}-target"}


def named_pairs(*owners):
    return {address: address for owner in owners for address in pair(owner).values()}


# Restore identities and original bytes before any step validates cross-owner relationships.
STEPS = (
    ("identity", pair("identity")),
    ("assets", pair("assets")),
    ("model_catalog", pair("models")),
    ("integrations_catalog", pair("integrations")),
    ("thought_documents", pair("thought")),
    ("creative_catalog", pair("creative")),
    ("director", pair("director")),
    ("annotation", pair("annotation")),
    ("presentation", {**pair("presentation"), "assets-target": "assets-target"}),
    (
        "editing_history",
        {**named_pairs("motion", "video", "assets"), "rendering-target": "rendering-target"},
    ),
    ("visual_history", named_pairs("visual", "assets")),
    ("galgame_history", named_pairs("galgame", "assets")),
    ("interview", pair("interview")),
    ("amadeus_history", pair("amadeus")),
    ("tools_navigation", pair("tools")),
    ("remote_preferences", pair("remote")),
    ("thought_references", {"source": "thought-source", "target": "assets-target"}),
    ("annotation_references", {"source": "annotation-source", "target": "assets-target"}),
    (
        "creative_installations",
        {
            "source": "creative-target",
            "target": "integrations-target",
            "legacy": "integrations-source",
        },
    ),
)
ENDPOINTS = {address for _, args in STEPS for address in args.values()}


def read_endpoints(path):
    entries = json.loads(private_config(path).read_text())
    if not isinstance(entries, dict) or entries.keys() != ENDPOINTS:
        raise ValueError("维护入口清单须覆盖全部迁移端点")
    endpoints = {}
    for key, value in entries.items():
        parsed = urlsplit(loopback(value))
        host = "[::1]" if parsed.hostname == "::1" else "127.0.0.1"
        endpoints[key] = f"http://{host}:{parsed.port}"
    if len(set(endpoints.values())) != len(endpoints):
        raise ValueError("每个维护进程须使用独立回环地址")
    return endpoints


def step_report(name, args, plan_path, lock_fd):
    command = [sys.executable, "-m", f"scripts.website.migrate_{name}", "--plan", str(plan_path)]
    for argument, address in args.items():
        command.extend((f"--{argument}", address))
    result = subprocess.run(
        command, cwd=ROOT, check=False, stdout=subprocess.PIPE, text=True, pass_fds=(lock_fd,)
    )
    if result.returncode:
        raise ValueError(f"迁移步骤 {name} 失败（退出码 {result.returncode}）")
    report = json.loads(result.stdout)
    return report if isinstance(report, list) else [report]


def validate_coverage(source, steps):
    results = {}
    for records in steps.values():
        for record in records:
            dataset = record["dataset"]
            if dataset in results:
                raise ValueError(f"迁移报告重复登记数据集 {dataset}")
            results[dataset] = record

    def check(dataset, count=None):
        if dataset not in results:
            raise ValueError(f"缺少数据集验收结果 {dataset}")
        if count is not None and results[dataset].get("record_count") != count:
            raise ValueError(f"数据集记录数与封存来源不符 {dataset}")

    for row in source["tables"]:
        if not row["record_count"] or row["status"] == "retained_for_rollback":
            continue
        dataset = row.get("dataset")
        if dataset is not None:
            # A reference projection has one record per document and verifies every asset ID.
            count = (
                None
                if row["status"] == "rebuild_registered" or dataset in REFERENCE_DATASETS
                else row["record_count"]
            )
            check(dataset, count)
        elif row["table"] == "project_operation_receipts":
            for kind, count in row["partitions"].items():
                check(row["datasets"][kind], count)
        elif row["table"] == "platform_settings":
            defaults, policy = "models.account-defaults", "models.policy"
            check(defaults)
            check(policy)
            if results[defaults]["record_count"] + results[policy]["record_count"] != row[
                "partitions"
            ].get("models", 0):
                raise ValueError("Models 设置记录数与封存分区不符")
        else:
            raise ValueError(f"缺少来源表验收映射 {row['table']}")


def save_report(path, report):
    with NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as temp:
        staged = Path(temp.name)
        try:
            json.dump(report, temp, ensure_ascii=False, indent=2, sort_keys=True)
            temp.write("\n")
            temp.flush()
            os.fsync(temp.fileno())
            os.replace(staged, path)
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            staged.unlink(missing_ok=True)


def migrate(plan_path, snapshot, seal, endpoints, evidence):
    try:
        plan = MigrationPlan.read(plan_path)
    except (OSError, ValueError):
        raise ValueError("迁移计划无法读取或格式无效") from None
    catalog = json.loads((ROOT / "deploy/contracts/ownership.json").read_text())
    evidence = directory(evidence)
    info = evidence.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("验收目录必须由当前用户持有且权限为 0700")
    path = evidence / "transfer.json"
    lock = evidence / "transfer.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source = inspect_bundle(snapshot, plan=plan, manifest_sha256=seal, catalog=catalog)
        if source["pending_tables"]:
            raise ValueError("来源存在待处理的表：" + "、".join(source["pending_tables"]))
        identity = {
            "run_id": str(plan.run_id),
            "source_revision": plan.source_revision,
            "source_database_sha256": plan.source_database_sha256,
            "manifest_sha256": seal,
        }
        report = {
            **identity,
            "source": source,
            "complete": False,
            "steps": {},
        }
        previous = {}
        if path.exists() or path.is_symlink():
            prior_report = json.loads(private_config(path).read_text())
            if any(prior_report.get(key) != value for key, value in identity.items()):
                raise ValueError("现有验收记录属于不同的迁移计划")
            previous = prior_report["steps"]
            if set(previous) - {name for name, _ in STEPS}:
                raise ValueError("现有验收记录包含未登记的迁移步骤")
        # Keep verified results across an interruption, but replay every step to prove
        # the current target still matches its persisted receipts and the sealed source.
        report["steps"].update(previous)
        save_report(path, report)
        for name, mapping in STEPS:
            print(f"迁移并核验 {name}", file=sys.stderr, flush=True)
            results = step_report(
                name, {key: endpoints[value] for key, value in mapping.items()}, plan_path, fd
            )
            if name in previous and previous[name] != results:
                raise ValueError(f"重放后的迁移报告变化 {name}")
            report["steps"][name] = results
            save_report(path, report)
        validate_coverage(source, report["steps"])
        if inspect_bundle(snapshot, plan=plan, manifest_sha256=seal, catalog=catalog) != source:
            raise ValueError("迁移期间封存来源发生变化")
        report["complete"] = True
        save_report(path, report)
        return path
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--endpoints", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    options = parser.parse_args()
    try:
        endpoints = read_endpoints(options.endpoints)
        report = migrate(
            options.plan.absolute(),
            options.snapshot,
            options.manifest_sha256,
            endpoints,
            options.evidence,
        )
    except BlockingIOError:
        parser.exit(1, "该验收目录已被另一个迁移进程持有\n")
    except (
        OSError,
        ValueError,
        argparse.ArgumentTypeError,
        KeyError,
        TypeError,
        sqlite3.Error,
    ) as exc:
        parser.exit(1, f"整站迁移未通过：{exc}\n")
    print(report)


if __name__ == "__main__":
    main()
