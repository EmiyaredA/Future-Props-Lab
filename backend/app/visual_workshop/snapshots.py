from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import (
    AssetStorage,
    ExportedProjectSnapshot,
    IncomingFile,
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
    move_staged_asset,
    stage_project_snapshot,
)
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualAssetFolder,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)
from app.runtime.config import Settings
from app.runtime.ids import new_id
from app.schemas.project_snapshots import ProjectSnapshotImportWarning
from app.schemas.visual_workshop import (
    VisualCanvasDocumentPutIn,
    VisualProjectSnapshotImportOut,
    VisualWorkshopProjectCreateIn,
)
from app.visual_workshop.projects import project_out


def _copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def _asset_record(
    asset: VisualAsset,
    *,
    folder_id: str | None,
    display_name: str,
) -> dict:
    return {
        "id": asset.id,
        "folder_id": folder_id,
        "original_filename": asset.original_filename,
        "display_name": display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
    }


def _validated_asset_records(value: object, declared: set[str]) -> list[dict]:
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


def _validated_folders(value: object) -> list[dict[str, str | None]]:
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


def _canvas_asset_ids(nodes: list[dict]) -> set[str]:
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


async def _model_references(
    session: AsyncSession, model_ids: set[str], workspace_id: str
) -> dict[str, dict]:
    if not model_ids:
        return {}
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.id.in_(model_ids),
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
            )
        )
    ).all()
    return {
        model.id: {"provider_kind": provider.kind, "model_slug": model.slug}
        for model, provider in rows
    }


async def _resolve_models(
    session: AsyncSession, references: object, workspace_id: str
) -> dict[str, str]:
    if not isinstance(references, dict):
        return {}
    pairs = {
        (str(item.get("provider_kind") or ""), str(item.get("model_slug") or ""))
        for item in references.values()
        if isinstance(item, dict)
    }
    if not pairs:
        return {}
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
            )
        )
    ).all()
    by_pair: dict[tuple[str, str], list[str]] = {}
    for model, provider in rows:
        by_pair.setdefault((provider.kind, model.slug), []).append(model.id)
    result: dict[str, str] = {}
    for source_id, item in references.items():
        if not isinstance(item, dict):
            continue
        ids = by_pair.get(
            (str(item.get("provider_kind") or ""), str(item.get("model_slug") or "")), []
        )
        if len(ids) == 1:
            result[str(source_id)] = ids[0]
    return result


def _remap_canvas(
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
        source_model = draft.get("model_id")
        if source_model:
            draft["model_id"] = model_ids.get(source_model)
            if source_model not in model_ids and source_model in model_references:
                warnings.append(
                    ProjectSnapshotImportWarning(
                        code="model_binding_unavailable",
                        field=f"canvas.nodes[{index}].generation_draft.model_id",
                        message="原生成模型在当前 Workspace 中不可用，请重新选择。",
                    )
                )
    edges = [edge.model_dump(mode="json") for edge in canvas.edges]
    return nodes, edges, warnings


class VisualWorkshopProjectSnapshots:
    application_id = "visual-workshop"

    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.settings = settings
        self.workspace_id = workspace_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(VisualWorkshopProject).where(
                    VisualWorkshopProject.id == project_id,
                    VisualWorkshopProject.workspace_id == self.workspace_id,
                )
            )
        ).scalar_one_or_none()
        canvas = await self.session.get(VisualCanvasDocument, project_id) if project else None
        if project is None or canvas is None:
            raise ProjectSnapshotError("项目不存在", code="not_found", status=404)
        folders = list(
            (
                await self.session.execute(
                    select(VisualAssetFolder).where(
                        VisualAssetFolder.project_id == project_id,
                        VisualAssetFolder.workspace_id == self.workspace_id,
                    )
                )
            ).scalars()
        )
        private_assets = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.project_id == project_id,
                        VisualAsset.workspace_id == self.workspace_id,
                    )
                )
            ).scalars()
        )
        references = (
            await self.session.execute(
                select(VisualProjectAssetReference, VisualAsset)
                .join(VisualAsset, VisualAsset.id == VisualProjectAssetReference.asset_id)
                .where(
                    VisualProjectAssetReference.project_id == project_id,
                    VisualProjectAssetReference.workspace_id == self.workspace_id,
                    VisualAsset.workspace_id == self.workspace_id,
                )
            )
        ).all()
        nodes = deepcopy(canvas.nodes or [])
        used_ids = _canvas_asset_ids(nodes)
        generated_output_ids = set(
            (
                await self.session.execute(
                    select(VisualGenerationTask.result_asset_id).where(
                        VisualGenerationTask.project_id == project_id,
                        VisualGenerationTask.workspace_id == self.workspace_id,
                        VisualGenerationTask.result_asset_id.is_not(None),
                    )
                )
            ).scalars()
        )
        selected_private = [
            asset
            for asset in private_assets
            if asset.id not in generated_output_ids or asset.id in used_ids
        ]
        asset_records = [
            _asset_record(asset, folder_id=asset.folder_id, display_name=asset.display_name)
            for asset in selected_private
        ]
        sources = [
            SnapshotAssetSource(asset.id, self.storage.path_for(asset))
            for asset in selected_private
        ]
        seen = {asset.id for asset in selected_private}
        for reference, asset in references:
            if asset.id in seen or asset.id not in used_ids:
                continue
            seen.add(asset.id)
            asset_records.append(
                _asset_record(
                    asset,
                    folder_id=reference.folder_id,
                    display_name=reference.display_name,
                )
            )
            sources.append(SnapshotAssetSource(asset.id, self.storage.path_for(asset)))
        model_ids = {
            str(draft["model_id"])
            for node in nodes
            if isinstance(node, dict)
            for draft in [node.get("generation_draft")]
            if isinstance(draft, dict) and draft.get("model_id")
        }
        payload = {
            "schema_version": 1,
            "project": {"title": project.title, "kind": project.kind, "status": project.status},
            "canvas": {"nodes": nodes, "edges": deepcopy(canvas.edges or [])},
            "folders": [
                {"id": row.id, "parent_id": row.parent_id, "name": row.name} for row in folders
            ],
            "assets": asset_records,
            "model_references": await _model_references(self.session, model_ids, self.workspace_id),
        }
        title = project.title
        source_project = project_out(project).model_dump(mode="json")
        await self.session.rollback()
        return await export_project_snapshot(
            self.settings,
            application_id=self.application_id,
            title=title,
            source_project=source_project,
            project=payload,
            assets=sources,
        )

    async def import_snapshot(self, upload: IncomingFile) -> VisualProjectSnapshotImportOut:
        staged = await stage_project_snapshot(
            self.settings, upload, expected_application=self.application_id
        )
        try:
            payload = staged.project
            if payload.get("schema_version") != 1 or not isinstance(payload.get("project"), dict):
                raise ProjectSnapshotError("project.json 不是受支持的视觉工坊快照")
            source_project = payload["project"]
            try:
                create = VisualWorkshopProjectCreateIn.model_validate(source_project)
                canvas = VisualCanvasDocumentPutIn.model_validate(
                    {"expected_revision": 0, **(payload.get("canvas") or {})}
                )
            except ValidationError as exc:
                raise ProjectSnapshotError("视觉画布结构无效") from exc
            status = str(source_project.get("status") or "")
            if status not in {"draft", "completed"}:
                raise ProjectSnapshotError("视觉项目状态无效")
            declared = {item.source_id for item in staged.manifest.assets}
            assets = _validated_asset_records(payload.get("assets"), declared)
            folders = _validated_folders(payload.get("folders"))
            folder_ids = {str(item["id"]): new_id() for item in folders}
            if any(
                item.get("folder_id") is not None and item.get("folder_id") not in folder_ids
                for item in assets
            ):
                raise ProjectSnapshotError("视觉项目素材引用的文件夹不存在")
            asset_ids = {item["id"]: new_id() for item in assets}
            model_ids = await _resolve_models(
                self.session, payload.get("model_references"), self.workspace_id
            )
            nodes, edges, warnings = _remap_canvas(
                canvas, asset_ids, model_ids, payload.get("model_references")
            )
            project = VisualWorkshopProject(
                id=new_id(),
                workspace_id=self.workspace_id,
                title=_copy_title(create.title),
                kind=create.kind,
                status=status,
            )
            self.session.add(project)
            await self.session.flush()
            async with importing_project_layout(
                self.session,
                self.storage,
                self.application_id,
                project.id,
                workspace_id=self.workspace_id,
            ):
                for item in folders:
                    self.session.add(
                        VisualAssetFolder(
                            id=folder_ids[item["id"]],
                            workspace_id=self.workspace_id,
                            project_id=project.id,
                            parent_id=folder_ids.get(item.get("parent_id")),
                            name=str(item["name"]),
                        )
                    )
                    await self.session.flush()
                for item in assets:
                    storage_key = uuid4().hex
                    asset = VisualAsset(
                        id=asset_ids[item["id"]],
                        workspace_id=self.workspace_id,
                        project_id=project.id,
                        folder_id=folder_ids.get(item.get("folder_id")),
                        original_filename=item["original_filename"],
                        display_name=item["display_name"],
                        storage_key=storage_key,
                        storage_version=TARGET_STORAGE_VERSION,
                        media_kind=item["media_kind"],
                        mime_type=item["mime_type"],
                        byte_size=item["byte_size"],
                    )
                    self.session.add(asset)
                    move_staged_asset(
                        staged.asset_path(item["id"]),
                        self.storage.target_path(
                            storage_key,
                            visual_project_id=project.id,
                            galgame_project_id=None,
                            workspace_id=self.workspace_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                self.session.add(
                    VisualCanvasDocument(project_id=project.id, nodes=nodes, edges=edges)
                )
            await self.session.refresh(project)
            return VisualProjectSnapshotImportOut(project=project_out(project), warnings=warnings)
        finally:
            staged.cleanup()
