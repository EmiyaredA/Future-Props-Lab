"""Compatibility adapter for acceptance asset metadata in the legacy owner."""

from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings
from studio.apps.visual_workshop.acceptance.access import asset
from studio.apps.visual_workshop.acceptance.context_values import ContextAsset
from studio.apps.visual_workshop.acceptance.context_values import fingerprint as fingerprint
from studio.apps.visual_workshop.acceptance.context_values import (
    resolve_context as resolve_with_assets,
)
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError


async def resolve_context(session, owner_user_id, project_id, node_id, scheme_id, output_id=None):
    async def load_assets(identities):
        storage = AssetStorage(get_settings())
        result = {}
        for identity in sorted(identities):
            try:
                row = await asset(session, owner_user_id, project_id, identity)
            except AcceptanceError as exc:
                if exc.status != 404:
                    raise
                continue
            result[identity] = ContextAsset(
                id=row.id,
                display_name=row.display_name,
                original_filename=row.original_filename,
                media_kind=row.media_kind,
                readable=storage.path_for(row).is_file(),
            )
        return result

    return await resolve_with_assets(
        session, owner_user_id, project_id, node_id, scheme_id, output_id, load_assets=load_assets
    )
