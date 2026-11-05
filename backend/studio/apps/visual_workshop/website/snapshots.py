from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import (
    AssetStorage,
    ExportedProjectSnapshot,
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
    move_staged_asset,
    stage_project_snapshot,
)
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualAssetFolder,
    VisualProjectAssetReference,
)
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from studio.apps.model_service.catalog.visual import resolve_snapshot_models, snapshot_model_labels
from studio.apps.visual_workshop.acceptance.snapshots import export_acceptance, import_acceptance
from studio.apps.visual_workshop.outputs.snapshots import export_outputs, import_outputs
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentPutIn,
    VisualProjectSnapshotImportOut,
    VisualWorkshopProjectCreateIn,
    default_material_categories,
)
from studio.apps.visual_workshop.snapshot_values import (
    canvas_asset_ids,
    copy_title,
    remap_canvas,
    validated_asset_records,
    validated_folders,
)
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.apps.visual_workshop.website.projects import project_out
from studio.config.settings import Settings
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.ids import new_id


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


class VisualWorkshopProjectSnapshots:
    application_id = "visual-workshop"

    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(VisualWorkshopProject).where(
                    VisualWorkshopProject.id == project_id,
                    VisualWorkshopProject.owner_user_id == self.owner_user_id,
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
                        VisualAssetFolder.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        private_assets = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
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
                    VisualProjectAssetReference.owner_user_id == self.owner_user_id,
                    VisualAsset.owner_user_id == self.owner_user_id,
                )
            )
        ).all()
        nodes = deepcopy(canvas.nodes or [])
        node_ids = {node["id"] for node in nodes}
        outputs = [
            output
            for output in await export_outputs(self.session, project_id)
            if output["node_id"] in node_ids
        ]
        acceptance, acceptance_assets = await export_acceptance(self.session, project_id)
        used_ids = canvas_asset_ids(nodes) | acceptance_assets
        for output in outputs:
            if output.get("inspection_asset_id"):
                used_ids.add(output["inspection_asset_id"])
            if output.get("asset_id"):
                used_ids.add(output["asset_id"])
            used_ids.update(
                reference["asset_id"]
                for reference in output["input_snapshot"]
                if reference.get("asset_id")
            )
        generated_output_ids = set(
            (
                await self.session.execute(
                    select(VisualGenerationTask.result_asset_id).where(
                        VisualGenerationTask.project_id == project_id,
                        VisualGenerationTask.owner_user_id == self.owner_user_id,
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
        # History remains a valid project-owned reference after a library tree entry is removed.
        history_assets = await self.session.scalars(
            select(VisualAsset).where(
                VisualAsset.owner_user_id == self.owner_user_id, VisualAsset.id.in_(used_ids - seen)
            )
        )
        for asset in history_assets:
            seen.add(asset.id)
            asset_records.append(
                _asset_record(asset, folder_id=None, display_name=asset.display_name)
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
            "canvas": {
                "nodes": nodes,
                "edges": deepcopy(canvas.edges or []),
                "categories": canvas.categories
                or [item.model_dump(mode="json") for item in default_material_categories()],
            },
            "outputs": outputs,
            "acceptance": acceptance,
            "folders": [
                {"id": row.id, "parent_id": row.parent_id, "name": row.name} for row in folders
            ],
            "assets": asset_records,
            "model_references": await snapshot_model_labels(
                self.session, self.owner_user_id, model_ids
            ),
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
            assets = validated_asset_records(payload.get("assets"), declared)
            folders = validated_folders(payload.get("folders"))
            folder_ids = {str(item["id"]): new_id() for item in folders}
            if any(
                item.get("folder_id") is not None and item.get("folder_id") not in folder_ids
                for item in assets
            ):
                raise ProjectSnapshotError("视觉项目素材引用的文件夹不存在")
            asset_ids = {item["id"]: new_id() for item in assets}
            model_ids = await resolve_snapshot_models(
                self.session, payload.get("model_references"), self.owner_user_id
            )
            nodes, edges, warnings = remap_canvas(
                canvas, asset_ids, model_ids, payload.get("model_references")
            )
            project = VisualWorkshopProject(
                id=new_id(),
                owner_user_id=self.owner_user_id,
                title=copy_title(create.title),
                kind=create.kind,
                status=status,
            )
            old_nodes = [node["id"] for node in nodes]
            outputs = import_outputs(
                payload.get("outputs", []), nodes, edges, asset_ids, project.id
            )
            asset_kinds = {asset_ids[item["id"]]: item["media_kind"] for item in assets}
            asset_mimes = {asset_ids[item["id"]]: item["mime_type"] for item in assets}
            if any(row.asset_id and asset_kinds[row.asset_id] != row.kind for row in outputs):
                raise ProjectSnapshotError("历史版本与素材类型不匹配")
            if any(
                row.inspection_asset_id
                and (
                    asset_kinds[row.inspection_asset_id] != "video"
                    or asset_mimes[row.inspection_asset_id] != "video/webm"
                )
                for row in outputs
            ):
                raise ProjectSnapshotError("检查视频与素材类型不匹配")
            self.session.add(project)
            await self.session.flush()
            async with importing_project_layout(
                self.session,
                self.storage,
                self.application_id,
                project.id,
                owner_user_id=self.owner_user_id,
            ):
                for item in folders:
                    self.session.add(
                        VisualAssetFolder(
                            id=folder_ids[item["id"]],
                            owner_user_id=self.owner_user_id,
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
                        owner_user_id=self.owner_user_id,
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
                            owner_user_id=self.owner_user_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                await self.session.flush()
                self.session.add_all(outputs)
                await self.session.flush()
                node_ids = dict(zip(old_nodes, [node["id"] for node in nodes], strict=True))
                output_ids = {
                    original["id"]: row.id
                    for original, row in zip(payload.get("outputs", []), outputs, strict=False)
                }
                await import_acceptance(
                    self.session,
                    payload.get("acceptance"),
                    project.id,
                    self.owner_user_id,
                    node_ids,
                    output_ids,
                    asset_ids,
                )
                if (
                    payload.get("acceptance", {}).get("required")
                    if payload.get("acceptance")
                    else False
                ):
                    for node in nodes:
                        node["approved"] = False
                self.session.add(
                    VisualCanvasDocument(
                        project_id=project.id,
                        nodes=nodes,
                        edges=edges,
                        categories=[
                            item.model_dump(mode="json")
                            for item in (canvas.categories or default_material_categories())
                        ],
                    )
                )
            await self.session.refresh(project)
            return VisualProjectSnapshotImportOut(project=project_out(project), warnings=warnings)
        finally:
            staged.cleanup()
