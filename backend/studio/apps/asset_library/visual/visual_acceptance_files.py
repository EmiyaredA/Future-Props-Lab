"""Project-owned metadata for the exact files used by Visual acceptance."""

from sqlalchemy import or_, select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.storage.service_models import VisualProjectFileLink
from studio.contracts.visual_workshop.visual_acceptance_assets import AcceptanceAsset


async def read_context_assets(session, settings, project, identities):
    await check_project_scope(session, "visual", project)
    owner = session.info["owner_user_id"]
    placements = select(VisualProjectFileLink.asset_id).where(
        VisualProjectFileLink.owner_user_id == owner,
        VisualProjectFileLink.project_id == project,
    )
    rows = await session.scalars(
        select(VisualAsset)
        .where(
            VisualAsset.owner_user_id == owner,
            VisualAsset.id.in_(identities),
            or_(
                VisualAsset.project_id == project,
                VisualAsset.id.in_(placements)
                & VisualAsset.project_id.is_(None)
                & VisualAsset.galgame_project_id.is_(None)
                & VisualAsset.video_editor_project_id.is_(None)
                & VisualAsset.motion_compositor_project_id.is_(None),
            ),
        )
        .order_by(VisualAsset.id)
    )
    storage = AssetStorage(settings)
    return [
        AcceptanceAsset(
            id=row.id,
            display_name=row.display_name,
            original_filename=row.original_filename,
            media_kind=row.media_kind,
            readable=storage.path_for(row).is_file(),
        )
        for row in rows
    ]
