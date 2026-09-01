# ruff: noqa: F401, F403

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from math import floor
from pathlib import Path
from typing import Any

import httpx

try:
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from management_api import management_api_key

try:
    from scripts.demo.galgame_runaway.cues import (
        CG_ASSETS,
        CG_EVENT_STARTS,
        CG_EVENTS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )
except ModuleNotFoundError:
    from cues import (  # type: ignore[no-redef]
        CG_ASSETS,
        CG_EVENT_STARTS,
        CG_EVENTS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )

try:
    from scripts.demo.galgame_runaway.performance_spec import *
except ModuleNotFoundError:
    from performance_spec import *  # type: ignore[no-redef]  # noqa: F403


class ApiError(RuntimeError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过正式 API 导入 SG0 素材并重做目标广播剧演出")
    parser.add_argument(
        "action",
        choices=(
            "inspect",
            "rename-kurisu",
            "rename-expressions",
            "upload",
            "apply",
            "audit",
            "all",
        ),
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--original-source-root", type=Path, required=True)
    parser.add_argument("--annotation", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--batch-size", type=int, default=12)
    return parser.parse_args()


def timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n" or len(header) < 24:
        raise RuntimeError(f"不是可识别的 PNG 素材：{path}")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    files: list[tuple[str, tuple[str, Any, str]]] | None = None,
    data: dict[str, str] | None = None,
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import request_json as run

    return run(client, method, path, payload=payload, files=files, data=data)


def project_path(project_id: str, suffix: str) -> str:
    from scripts.demo.galgame_runaway.performance_http import project_path as run

    return run(project_id, suffix)


def scene_id_for_code(code: str) -> str:
    if code.startswith("SG_"):
        return f"sg-{code.removeprefix('SG_').lower().replace('_', '-')}"
    return f"sg0-{code.lower().replace('_', '-')}"


def scene_asset_id_for_code(code: str) -> str:
    if code.startswith("SG_"):
        return f"{scene_id_for_code(code)}-scene"
    return f"sg0-scene-{code.lower().replace('_', '-')}"


def source_entries(
    source_root: Path,
    original_source_root: Path,
) -> list[dict[str, Any]]:
    from scripts.demo.galgame_runaway.performance_assets import source_entries as run

    return run(source_root, original_source_root)


def logical_library_entries(
    source_root: Path,
    original_source_root: Path,
) -> list[dict[str, Any]]:
    from scripts.demo.galgame_runaway.performance_assets import (
        logical_library_entries as run,
    )

    return run(source_root, original_source_root)


def load_asset_map(project_id: str, source_root: Path) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_assets import load_asset_map as run

    return run(project_id, source_root)


def upload_assets(
    client: httpx.Client,
    project_id: str,
    source_root: Path,
    original_source_root: Path,
    batch_size: int,
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_assets import upload_assets as run

    return run(client, project_id, source_root, original_source_root, batch_size)


def find_character(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import find_character as run

    return run(*args, **kwargs)


def first_person_okabe(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import first_person_okabe as run

    return run(*args, **kwargs)


def semantic_suzuha_expression(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import semantic_suzuha_expression as run

    return run(*args, **kwargs)


def ensure_story_image_asset(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import ensure_story_image_asset as run

    return run(*args, **kwargs)


def upgrade_suzuha(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import upgrade_suzuha as run

    return run(*args, **kwargs)


def set_all_lip_sync_fps(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import set_all_lip_sync_fps as run

    return run(*args, **kwargs)


def build_curated_expression(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import build_curated_expression as run

    return run(*args, **kwargs)


def install_curated_character_expressions(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        install_curated_character_expressions as run,
    )

    return run(*args, **kwargs)


def performance_expression_id(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import performance_expression_id as run

    return run(*args, **kwargs)


def performance_expression_for_turn(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        performance_expression_for_turn as run,
    )

    return run(*args, **kwargs)


def enlarge_dialogue_text(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import enlarge_dialogue_text as run

    return run(*args, **kwargs)


def install_curated_scenes(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import install_curated_scenes as run

    return run(*args, **kwargs)


def install_cgs(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import install_cgs as run

    return run(*args, **kwargs)


def install_opening_declaration(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        install_opening_declaration as run,
    )

    return run(*args, **kwargs)


def install_ending_thanks(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import install_ending_thanks as run

    return run(*args, **kwargs)


def install_transition_cards(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import install_transition_cards as run

    return run(*args, **kwargs)


def dialogue_signature(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import dialogue_signature as run

    return run(*args, **kwargs)


def dialogue_timeline_signature(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        dialogue_timeline_signature as run,
    )

    return run(*args, **kwargs)


def annotation_text(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import annotation_text as run

    return run(*args, **kwargs)


def annotation_character_map(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import annotation_character_map as run

    return run(*args, **kwargs)


def apply_annotation(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import apply_annotation as run

    return run(*args, **kwargs)


def ensure_literal_display_name(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        ensure_literal_display_name as run,
    )

    return run(*args, **kwargs)


def configure_dialogue_display_names(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        configure_dialogue_display_names as run,
    )

    return run(*args, **kwargs)


def install_special_character_expressions(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        install_special_character_expressions as run,
    )

    return run(*args, **kwargs)


def normalize_expression_labels(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        normalize_expression_labels as run,
    )

    return run(*args, **kwargs)


def rename_kurisu_expression_labels(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        rename_kurisu_expression_labels as run,
    )

    return run(*args, **kwargs)


def rename_audited_expression_labels(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        rename_audited_expression_labels as run,
    )

    return run(*args, **kwargs)


def target_fragment(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import target_fragment as run

    return run(*args, **kwargs)


def portrait_height_percent(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import portrait_height_percent as run

    return run(*args, **kwargs)


def cast_member(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import cast_member as run

    return run(*args, **kwargs)


def visible_cast_for_dialogue(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import visible_cast_for_dialogue as run

    return run(*args, **kwargs)


def remembered_cast_expression(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import remembered_cast_expression as run

    return run(*args, **kwargs)


def clear_adjacent_direct_portrait_overlaps(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import (
        clear_adjacent_direct_portrait_overlaps as run,
    )

    return run(*args, **kwargs)


def fullscreen_cg_at(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import fullscreen_cg_at as run

    return run(*args, **kwargs)


def install_performance_blocks(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import install_performance_blocks as run

    return run(*args, **kwargs)


def audit_document(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import audit_document as run

    return run(*args, **kwargs)


def transform_latest_story(*args: Any, **kwargs: Any) -> Any:
    from scripts.demo.galgame_runaway.performance_transform import transform_latest_story as run

    return run(*args, **kwargs)


def apply_story(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import apply_story as run

    return run(client, project_id, mapping, source_root, original_source_root, annotation_path)


def inspect(client: httpx.Client, project_id: str) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import inspect as run

    return run(client, project_id)


def rename_live_expression_labels(
    client: httpx.Client,
    project_id: str,
    *,
    character_ids: set[str] | None = None,
    backup_name: str = "expression-labels",
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import (
        rename_live_expression_labels as run,
    )

    return run(
        client,
        project_id,
        character_ids=character_ids,
        backup_name=backup_name,
    )


def rename_live_kurisu_expressions(client: httpx.Client, project_id: str) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import (
        rename_live_kurisu_expressions as run,
    )

    return run(client, project_id)


def audit_live(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_http import audit_live as run

    return run(client, project_id, mapping, source_root, original_source_root, annotation_path)


def main() -> None:
    args = parse_args()
    management_key = management_api_key()
    if not args.source_root.is_dir():
        raise RuntimeError(f"SG0 素材目录不存在：{args.source_root}")
    if not args.original_source_root.is_dir():
        raise RuntimeError(f"原作素材目录不存在：{args.original_source_root}")
    if not args.annotation.is_file():
        raise RuntimeError(f"新版对白标注不存在：{args.annotation}")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        if args.action == "inspect":
            inspect(client, args.project_id)
            return
        if args.action == "rename-kurisu":
            rename_live_kurisu_expressions(client, args.project_id)
            return
        if args.action == "rename-expressions":
            rename_live_expression_labels(client, args.project_id)
            return
        mapping = load_asset_map(args.project_id, args.source_root)
        if args.action in {"upload", "all"}:
            mapping = upload_assets(
                client,
                args.project_id,
                args.source_root,
                args.original_source_root,
                args.batch_size,
            )
        if args.action in {"apply", "all"}:
            apply_story(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.original_source_root,
                args.annotation,
            )
        if args.action in {"audit", "all"}:
            audit_live(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.original_source_root,
                args.annotation,
            )


if __name__ == "__main__":
    main()
