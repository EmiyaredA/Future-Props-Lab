"""Validated file staging followed by one short output/CAS transaction."""

from app.apps.visual_workshop.canvas import VisualCanvasDocuments, VisualCanvasError
from app.apps.visual_workshop.outputs.history import NodeOutputs, OutputError
from app.apps.visual_workshop.outputs.schemas import VisualNodeOutputCreateIn
from app.apps.visual_workshop.outputs.video_uploads import prepare_output_upload
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.capabilities.asset_store import IncomingFile
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.policy import ALLOWED_FILES
from app.runtime.config import Settings
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError


async def upload_version(
    outputs: NodeOutputs,
    settings: Settings,
    project_id: str,
    node_id: str,
    upload: IncomingFile,
    expected_revision: int,
):
    canvas, node = await outputs.document(project_id, node_id)
    if node["kind"] == "text":
        raise OutputError("文本节点请使用保存版本")
    if canvas.revision != expected_revision:
        await outputs.claim(canvas, expected_revision)
    extensions = {
        extension for extension, (kind, _) in ALLOWED_FILES.items() if kind == node["kind"]
    }
    library = AssetLibrary(outputs.session, settings)
    assets = []
    committed = False
    # Release the read transaction before conversion and large file I/O.
    kind = node["kind"]
    await outputs.session.rollback()
    try:
        async with prepare_output_upload(
            upload, kind, max_bytes=settings.fpl_visual_asset_max_bytes
        ) as (prepared, inspection):
            asset = await library.store_upload(
                prepared,
                workspace_id=outputs.workspace_id,
                visual_project_id=project_id,
                allowed_extensions=extensions,
                commit=False,
                defer_persistence=True,
            )
            assets.append(asset)
            inspection_asset = None
            if inspection:
                inspection_asset = await library.store_upload(
                    inspection,
                    workspace_id=outputs.workspace_id,
                    visual_project_id=project_id,
                    allowed_extensions={".webm"},
                    commit=False,
                    defer_persistence=True,
                )
                assets.append(inspection_asset)
            outputs.session.add_all(assets)
            await outputs.session.flush()
            await outputs.add(
                project_id,
                node_id,
                VisualNodeOutputCreateIn(expected_revision=expected_revision, asset_id=asset.id),
                inspection_asset_id=inspection_asset.id if inspection_asset else None,
            )
            committed = True
    except BaseException:
        if not committed:
            paths = [library.storage.path_for(asset) for asset in assets]
            await outputs.session.rollback()
            for path in paths:
                path.unlink(missing_ok=True)
        raise


async def upload_material(
    session,
    settings: Settings,
    workspace_id: str,
    project_id: str,
    upload: IncomingFile,
    expected_revision: int,
    *,
    x: float = 0,
    y: float = 0,
    category_id: str | None = None,
    group: str | None = None,
):
    documents = VisualCanvasDocuments(session)
    current = await documents.get(project_id)
    if current.revision != expected_revision:
        raise RevisionConflictError(
            expected_revision, current.revision, current.model_dump(mode="json")
        )
    category = next((item for item in current.categories if item.id == category_id), None)
    if category_id and category is None:
        raise VisualCanvasError("上传目标分类不存在")
    if group and (category is None or group not in category.groups):
        raise VisualCanvasError("上传目标分组不存在")
    library = AssetLibrary(session, settings)
    asset = None
    try:
        asset = await library.store_upload(
            upload,
            workspace_id=workspace_id,
            visual_project_id=project_id,
            allowed_extensions={
                extension
                for extension, (kind, _) in ALLOWED_FILES.items()
                if kind in {"image", "audio", "video"}
            },
            commit=False,
        )
        result = await documents.replace(
            project_id,
            VisualCanvasDocumentPutIn(
                expected_revision=expected_revision,
                nodes=[
                    *current.nodes,
                    {
                        "id": new_id(),
                        "kind": asset.media_kind,
                        "title": asset.display_name,
                        "position": {"x": x, "y": y},
                        "asset_id": asset.id,
                        "category_id": category_id or None,
                        "group": group or None,
                    },
                ],
                edges=current.edges,
            ),
        )
        await session.commit()
        return result
    except Exception:
        path = library.storage.path_for(asset) if asset else None
        await session.rollback()
        if path:
            path.unlink(missing_ok=True)
        raise
