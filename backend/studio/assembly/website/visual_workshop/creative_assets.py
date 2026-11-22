"""Compatibility-site projection of scoped Visual library assets."""

from sqlalchemy import or_, select

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.visual_workshop.asset_references.models import VisualProjectAssetReference
from studio.apps.visual_workshop.creative_ports import CreativeAsset
from studio.apps.visual_workshop.projects import Projects


async def website_reference_image_guard(session, owner, project_id):
    await Projects(session, owner).row(project_id)


async def website_reference_image_identity(request, session, owner, project_id, asset_id):
    from studio.assembly.website.asset_library.transport.content import bind_content_audits

    await Projects(session, owner).row(project_id)
    result = await bind_content_audits(request, session, owner).identities([asset_id])
    return next((item for item in result.items if item.asset_id == asset_id), None)


async def website_creative_asset_scope(_request, session, owner, project_id, identities):
    if project_id is None:
        records = await session.execute(
            select(
                VisualAsset.id,
                VisualAsset.media_kind,
                VisualAsset.mime_type,
                VisualAsset.project_id,
            ).where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.id.in_(identities),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
                VisualAsset.motion_compositor_project_id.is_(None),
            )
        )
        return {
            identity: CreativeAsset(kind, mime, scope) for identity, kind, mime, scope in records
        }
    await Projects(session, owner).row(project_id)
    linked = select(VisualProjectAssetReference.asset_id).where(
        VisualProjectAssetReference.owner_user_id == owner,
        VisualProjectAssetReference.project_id == project_id,
    )
    records = await session.execute(
        select(
            VisualAsset.id, VisualAsset.media_kind, VisualAsset.mime_type, VisualAsset.project_id
        ).where(
            VisualAsset.owner_user_id == owner,
            VisualAsset.id.in_(identities),
            or_(VisualAsset.project_id == project_id, VisualAsset.id.in_(linked)),
        )
    )
    return {
        identity: CreativeAsset(kind, mime, scope)
        for identity, kind, mime, scope in records
        if mime != "model/gltf-binary" or scope == project_id
    }
