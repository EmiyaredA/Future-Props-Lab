"""Portable Visual snapshot values independent of storage."""

from pathlib import Path

from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from studio.contracts.asset_library.project_snapshots import ProjectSnapshotImportWarning
from studio.runtime.files.project_archives import ProjectSnapshotError


def canvas_asset_ids(nodes: list[dict]) -> set[str]:
    result: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("asset_id"):
            result.add(str(node["asset_id"]))
        draft = node.get("generation_draft")
        if not isinstance(draft, dict):
            continue
        for key in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id"):
            if draft.get(key):
                result.add(str(draft[key]))
        for key in ("reference_asset_ids", "audio_asset_ids", "video_asset_ids"):
            values = draft.get(key)
            if isinstance(values, list):
                result.update(str(value) for value in values if value)
    return result


def copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def validated_asset_records(value: object, declared: set[str]) -> list[dict]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("project.json 的 assets 必须是数组")
    records: list[dict] = []
    ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("project.json 包含无效素材记录")
        asset_id = str(item.get("id") or "")
        if not asset_id or asset_id in ids or asset_id not in declared:
            raise ProjectSnapshotError("项目素材记录与快照清单不一致")
        ids.add(asset_id)
        filename = Path(str(item.get("original_filename") or "")).name
        display_name = str(item.get("display_name") or "").strip()
        media_kind = str(item.get("media_kind") or "")
        mime_type = str(item.get("mime_type") or "")
        byte_size = item.get("byte_size")
        folder_id = item.get("folder_id")
        if (
            not filename
            or not display_name
            or len(filename) > 255
            or len(display_name) > 255
            or media_kind not in {"image", "video", "audio", "font", "document"}
            or not mime_type
            or len(mime_type) > 255
            or not isinstance(byte_size, int)
            or byte_size < 1
            or (folder_id is not None and not isinstance(folder_id, str))
        ):
            raise ProjectSnapshotError("项目快照包含无效素材元数据")
        records.append(dict(item, original_filename=filename, display_name=display_name))
    if ids != declared:
        raise ProjectSnapshotError("项目素材记录与快照清单不一致")
    return records


def validated_folders(value: object) -> list[dict[str, str | None]]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("视觉项目文件夹结构无效")
    by_id: dict[str, dict[str, str | None]] = {}
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("视觉项目文件夹结构无效")
        source_id = str(item.get("id") or "")
        raw_parent = item.get("parent_id")
        parent_id = str(raw_parent) if raw_parent is not None else None
        name = str(item.get("name") or "").strip()
        if not source_id or source_id in by_id or not 1 <= len(name) <= 120:
            raise ProjectSnapshotError("视觉项目文件夹结构无效")
        by_id[source_id] = {"id": source_id, "parent_id": parent_id, "name": name}
    if any(
        item["parent_id"] is not None and item["parent_id"] not in by_id for item in by_id.values()
    ):
        raise ProjectSnapshotError("视觉项目文件夹父级不存在")
    ordered: list[dict[str, str | None]] = []
    remaining = dict(by_id)
    emitted: set[str] = set()
    while remaining:
        ready = [
            item
            for item in remaining.values()
            if item["parent_id"] is None or item["parent_id"] in emitted
        ]
        if not ready:
            raise ProjectSnapshotError("视觉项目文件夹不能形成循环")
        for item in ready:
            ordered.append(item)
            emitted.add(str(item["id"]))
            remaining.pop(str(item["id"]))
    return ordered


def remap_canvas(
    canvas: VisualCanvasDocumentPutIn,
    asset_ids: dict[str, str],
    model_ids: dict[str, str],
    references: object,
) -> tuple[list[dict], list[dict], list[ProjectSnapshotImportWarning]]:
    nodes = [node.model_dump(mode="json") for node in canvas.nodes]
    warnings: list[ProjectSnapshotImportWarning] = []
    model_references = references if isinstance(references, dict) else {}

    def mapped_asset(value: object, field: str) -> str | None:
        if value is None:
            return None
        source_id = str(value)
        if source_id not in asset_ids:
            raise ProjectSnapshotError(f"视觉画布引用的素材未包含在快照中：{field}")
        return asset_ids[source_id]

    for index, node in enumerate(nodes):
        if node.get("asset_id") is not None:
            node["asset_id"] = mapped_asset(node["asset_id"], f"canvas.nodes[{index}].asset_id")
        node["generation_task_id"] = None
        if node["kind"] == "image":
            node["generation_batch_id"] = None
        draft = node.get("generation_draft")
        if not isinstance(draft, dict):
            continue
        for key in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id"):
            if draft.get(key) is not None:
                draft[key] = mapped_asset(draft[key], f"canvas.nodes[{index}].{key}")
        for key in ("reference_asset_ids", "audio_asset_ids", "video_asset_ids"):
            draft[key] = [
                mapped_asset(value, f"canvas.nodes[{index}].{key}") for value in draft.get(key, [])
            ]
        if "prompt_reference_names" in draft:
            draft["prompt_reference_names"] = {
                asset_ids[source_id]: name
                for source_id, name in draft["prompt_reference_names"].items()
                if source_id in asset_ids
            }
        source_model = draft.get("model_id")
        if source_model:
            draft["model_id"] = model_ids.get(source_model)
            if source_model not in model_ids and source_model in model_references:
                warnings.append(
                    ProjectSnapshotImportWarning(
                        code="model_binding_unavailable",
                        field=f"canvas.nodes[{index}].generation_draft.model_id",
                        message="原生成模型在当前账号中不可用，请重新选择。",
                    )
                )
    edges = [edge.model_dump(mode="json") for edge in canvas.edges]
    return nodes, edges, warnings
