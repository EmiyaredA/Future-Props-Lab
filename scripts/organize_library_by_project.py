#!/usr/bin/env python3
"""Organize workspace library root files into folders by consuming projects.

Uses the formal /v1 API via a website profile (default) or Management API Key.
Default mode is dry-run; pass --apply to create folders and move files.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "sdk" / "python" / "src"))

from future_props_lab.client import Client  # noqa: E402
from future_props_lab.encoding import UNSET  # noqa: E402
from future_props_lab.errors import RevisionConflict  # noqa: E402
from future_props_lab.website import website_client  # noqa: E402

SHARED_FOLDER = "共享素材"
UNREFERENCED_FOLDER = "未引用"
ASSET_REFERENCE_KEYS = {
    "assetId",
    "asset_id",
    "fileId",
    "file_id",
    "cover_asset_id",
}
APP_LABELS = {
    "visual": "视觉",
    "galgame": "Galgame",
    "annotation": "标注",
    "presentation": "演示",
    "thought": "思绪",
}


@dataclass(frozen=True)
class Consumer:
    app: str
    project_id: str
    title: str

    @property
    def key(self) -> tuple[str, str]:
        return (self.app, self.project_id)

    @property
    def folder_name(self) -> str:
        label = APP_LABELS.get(self.app, self.app)
        return _safe_folder_name(f"{label} · {self.title}")


@dataclass
class Assignment:
    asset_id: str
    display_name: str
    revision: int
    folder_name: str
    reason: str
    consumers: list[Consumer]


def _safe_folder_name(name: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f/\\]", " ", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or "未命名"


def _dump(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(by_alias=True, mode="python")
    if isinstance(model, dict):
        return model
    return dict(model)


def open_client(*, development: bool) -> Client:
    api_key = os.environ.get("FPL_MANAGEMENT_API_KEY", "").strip()
    base_url = os.environ.get("FPL_BASE_URL", "").strip()
    if api_key:
        if not api_key.startswith("fpm_"):
            raise SystemExit("FPL_MANAGEMENT_API_KEY 必须以 fpm_ 开头")
        return Client(base_url=base_url or "http://127.0.0.1:9000", api_key=api_key)
    return website_client(profile="development" if development else "default")


def list_all_scoped_files(client: Client, *, project_id: str | None = None) -> list:
    # Omit folder_id for root; explicit null can be rejected as a missing folder id.
    folders = client.files.list_file_folders(
        project_id=project_id if project_id is not None else UNSET
    ).items
    folder_ids: list[object] = [UNSET, *[folder.id for folder in folders]]
    seen: set[str] = set()
    items = []
    for folder_id in folder_ids:
        page = client.files.list_files(
            project_id=project_id if project_id is not None else UNSET,
            folder_id=folder_id,
            include_references=True if project_id else UNSET,
        )
        for item in page.items:
            if item.id in seen:
                continue
            seen.add(item.id)
            items.append(item)
    return items


def collect_asset_ids_from_json(node) -> set[str]:
    found: set[str] = set()

    def walk(value) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ASSET_REFERENCE_KEYS and isinstance(child, str):
                    if child:
                        found.add(child)
                else:
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return found


def add_consumer(
    consumers: dict[str, list[Consumer]],
    asset_id: str,
    consumer: Consumer,
) -> None:
    bucket = consumers.setdefault(asset_id, [])
    if any(existing.key == consumer.key for existing in bucket):
        return
    bucket.append(consumer)


def scan_visual(client: Client, consumers: dict[str, list[Consumer]]) -> None:
    for project in client.visual.list_projects().items:
        consumer = Consumer("visual", project.id, project.title)
        for asset in list_all_scoped_files(client, project_id=project.id):
            if asset.source == "library" or asset.is_reference:
                add_consumer(consumers, asset.id, consumer)


def scan_galgame(client: Client, consumers: dict[str, list[Consumer]]) -> None:
    for project in client.galgame.list_projects().items:
        consumer = Consumer("galgame", project.id, project.title)
        story = client.galgame.get_story(project_id=project.id)
        document = _dump(story.document)
        for asset_id in collect_asset_ids_from_json(document):
            add_consumer(consumers, asset_id, consumer)
        overview = client.galgame.get_project_asset_overview(project_id=project.id)
        for item in overview.items:
            add_consumer(consumers, item.id, consumer)


def scan_annotation(client: Client, consumers: dict[str, list[Consumer]]) -> None:
    for project in client.annotation.list_projects().items:
        consumer = Consumer("annotation", project.id, project.title)
        add_consumer(consumers, project.asset_id, consumer)


def scan_presentation(
    client: Client, consumers: dict[str, list[Consumer]], gaps: list[str]
) -> None:
    try:
        listing = client.presentation.list_projects()
    except Exception as exc:  # noqa: BLE001 — agent may deny this surface
        gaps.append(f"演示文稿扫描跳过：{exc}")
        return
    for summary in listing.items:
        try:
            project = client.presentation.get_project(project_id=summary.id)
        except Exception as exc:  # noqa: BLE001
            gaps.append(f"演示文稿 {summary.title!r} 读取失败：{exc}")
            continue
        consumer = Consumer("presentation", project.id, project.title)
        for asset_id in collect_asset_ids_from_json(_dump(project.document)):
            add_consumer(consumers, asset_id, consumer)


def scan_thought(client: Client, consumers: dict[str, list[Consumer]], gaps: list[str]) -> None:
    try:
        bases = client.thought.knowledge_bases()
    except Exception as exc:  # noqa: BLE001
        gaps.append(f"思绪工坊扫描跳过：{exc}")
        return
    for base in bases:
        consumer = Consumer("thought", base.id, base.title)
        if base.cover_asset_id:
            add_consumer(consumers, base.cover_asset_id, consumer)
        offset = 0
        while True:
            try:
                page = client.thought.list_notes(
                    knowledge_base_id=base.id,
                    view="all",
                    offset=offset,
                    limit=100,
                )
            except Exception as exc:  # noqa: BLE001
                gaps.append(f"思绪知识库 {base.title!r} 笔记列表失败：{exc}")
                break
            notes = page.items
            if not notes:
                break
            for summary in notes:
                try:
                    note = client.thought.get_note(note_id=summary.id)
                except Exception as exc:  # noqa: BLE001
                    gaps.append(f"思绪笔记 {summary.title!r} 读取失败：{exc}")
                    continue
                for asset_id in collect_asset_ids_from_json(note.document):
                    add_consumer(consumers, asset_id, consumer)
            offset += len(notes)
            if len(notes) < 100:
                break


def heuristic_existing_folder(
    display_name: str,
    original_filename: str,
    existing_root_folders: list,
) -> str | None:
    haystack = f"{display_name} {original_filename}".lower()
    for folder in existing_root_folders:
        tokens = [token for token in re.split(r"[\s·\-_/]+", folder.name) if len(token) >= 2]
        if any(token.lower() in haystack for token in tokens):
            return folder.name
    return None


def heuristic_project_folder(
    display_name: str,
    original_filename: str,
    project_folders: list[str],
) -> str | None:
    haystack = f"{display_name} {original_filename}".lower()
    matches: list[str] = []
    for folder_name in project_folders:
        # Prefer long distinctive tokens from project titles.
        title = folder_name.split(" · ", 1)[-1]
        tokens = [token for token in re.split(r"[\s·\-_/]+", title) if len(token) >= 2]
        if display_name.lower() in title.lower() or title.lower() in haystack:
            matches.append(folder_name)
            continue
        if any(token.lower() in haystack for token in tokens if len(token) >= 4):
            matches.append(folder_name)
    unique = list(dict.fromkeys(matches))
    if len(unique) == 1:
        return unique[0]
    return None


def assign_files(
    root_files: list,
    consumers: dict[str, list[Consumer]],
    existing_root_folders: list,
) -> list[Assignment]:
    project_folder_names = sorted(
        {consumer.folder_name for linked in consumers.values() for consumer in linked}
    )
    assignments: list[Assignment] = []
    for asset in root_files:
        linked = consumers.get(asset.id, [])
        unique_projects = {(c.app, c.project_id): c for c in linked}
        linked = list(unique_projects.values())
        if len(linked) == 1:
            consumer = linked[0]
            assignments.append(
                Assignment(
                    asset_id=asset.id,
                    display_name=asset.display_name,
                    revision=asset.revision,
                    folder_name=consumer.folder_name,
                    reason=f"引用自 {consumer.folder_name}",
                    consumers=linked,
                )
            )
        elif len(linked) > 1:
            labels = "、".join(sorted({c.folder_name for c in linked}))
            assignments.append(
                Assignment(
                    asset_id=asset.id,
                    display_name=asset.display_name,
                    revision=asset.revision,
                    folder_name=SHARED_FOLDER,
                    reason=f"多项目引用：{labels}",
                    consumers=linked,
                )
            )
        else:
            matched = heuristic_existing_folder(
                asset.display_name,
                asset.original_filename,
                existing_root_folders,
            )
            if matched:
                assignments.append(
                    Assignment(
                        asset_id=asset.id,
                        display_name=asset.display_name,
                        revision=asset.revision,
                        folder_name=matched,
                        reason=f"名称启发式匹配已有文件夹「{matched}」",
                        consumers=[],
                    )
                )
                continue
            matched_project = heuristic_project_folder(
                asset.display_name,
                asset.original_filename,
                project_folder_names,
            )
            if matched_project:
                assignments.append(
                    Assignment(
                        asset_id=asset.id,
                        display_name=asset.display_name,
                        revision=asset.revision,
                        folder_name=matched_project,
                        reason=f"名称启发式匹配项目「{matched_project}」",
                        consumers=[],
                    )
                )
            else:
                assignments.append(
                    Assignment(
                        asset_id=asset.id,
                        display_name=asset.display_name,
                        revision=asset.revision,
                        folder_name=UNREFERENCED_FOLDER,
                        reason="未发现项目引用",
                        consumers=[],
                    )
                )
    return assignments


def ensure_library_folder(client: Client, name: str, cache: dict[str, str]) -> str:
    if name in cache:
        return cache[name]
    created = client.files.create_file_folder(body={"scope": "library", "name": name})
    cache[name] = created.id
    return created.id


def move_asset(client: Client, assignment: Assignment, folder_id: str) -> None:
    revision = assignment.revision
    for attempt in range(2):
        try:
            client.files.patch_file(
                asset_id=assignment.asset_id,
                body={"expected_revision": revision, "folder_id": folder_id},
            )
            return
        except RevisionConflict as exc:
            current = getattr(exc, "current", None) or {}
            if isinstance(current, dict) and "revision" in current:
                revision = int(current["revision"])
            else:
                refreshed = client.files.list_files()
                match = next(
                    (item for item in refreshed.items if item.id == assignment.asset_id), None
                )
                if match is None:
                    raise
                revision = match.revision
            if attempt == 1:
                raise


def print_report(assignments: list[Assignment], gaps: list[str]) -> None:
    by_folder: dict[str, list[Assignment]] = defaultdict(list)
    for item in assignments:
        by_folder[item.folder_name].append(item)

    print(f"根目录待整理文件：{len(assignments)}")
    print("按目标文件夹汇总：")
    for folder_name in sorted(by_folder, key=lambda name: (-len(by_folder[name]), name)):
        print(f"  {folder_name}: {len(by_folder[folder_name])} 个")
    print()
    print("明细：")
    for folder_name in sorted(by_folder):
        print(f"[{folder_name}]")
        for item in sorted(by_folder[folder_name], key=lambda row: row.display_name.lower()):
            print(f"  - {item.display_name}  ({item.reason})")
        print()
    if gaps:
        print("扫描缺口：")
        for gap in gaps:
            print(f"  - {gap}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按关联项目整理公共库根目录文件")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="创建文件夹并移动文件；默认仅 dry-run",
    )
    parser.add_argument(
        "--development",
        action="store_true",
        help="连接隔离开发版桌面数据（Future Props Lab Development）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = open_client(development=args.development)
    try:
        library_folders = [
            folder for folder in client.files.list_file_folders().items if folder.parent_id is None
        ]
        root_files = [
            asset
            for asset in client.files.list_files().items
            if asset.folder_id is None and asset.source == "library"
        ]
        consumers: dict[str, list[Consumer]] = {}
        gaps: list[str] = []
        scan_visual(client, consumers)
        scan_galgame(client, consumers)
        scan_annotation(client, consumers)
        scan_presentation(client, consumers, gaps)
        scan_thought(client, consumers, gaps)

        assignments = assign_files(root_files, consumers, library_folders)
        print_report(assignments, gaps)

        if not args.apply:
            print("dry-run 完成，未写入。确认后加 --apply 执行。")
            return 0

        folder_cache = {folder.name: folder.id for folder in library_folders}
        moved = 0
        for assignment in assignments:
            folder_id = ensure_library_folder(client, assignment.folder_name, folder_cache)
            move_asset(client, assignment, folder_id)
            moved += 1
            print(
                f"moved {moved}/{len(assignments)}: "
                f"{assignment.display_name} -> {assignment.folder_name}"
            )

        remaining = client.files.list_files().items
        print(f"完成：移动 {moved} 个文件；根目录剩余文件 {len(remaining)} 个")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
