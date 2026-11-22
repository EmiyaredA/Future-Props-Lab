"""Legacy host supplies explicit reference checks; Assets never imports foreign stores."""

from collections import defaultdict

from sqlalchemy import select

from studio.apps.asset_library.content_audits import ContentAudits
from studio.apps.asset_library.storage.content_models import AssetDedupeCanonicalPin
from studio.apps.asset_library.transport.content_http import content_router
from studio.apps.visual_workshop.asset_references.models import VisualProjectAssetReference
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.website.asset_library.storage.website_files import VisualAssets
from studio.assembly.website.asset_library.storage.website_references import (
    protect_document_references,
)
from studio.contracts.asset_library.errors import AssetError


def bind_content_audits(request, session, owner):
    async def protect(identity):
        await protect_document_references(session, [identity])
        for _model, column in (
            (VisualProjectAssetReference, VisualProjectAssetReference.asset_id),
            (VisualNodeOutput, VisualNodeOutput.asset_id),
            (AssetDedupeCanonicalPin, AssetDedupeCanonicalPin.asset_id),
        ):
            if await session.scalar(select(column).where(column == identity).limit(1)):
                raise AssetError("素材仍被应用或历史引用", code="asset_in_use", status=409)

    async def protections(ids):
        result = defaultdict(set)
        for identity in ids:
            try:
                await protect(identity)
            except AssetError:
                result[identity].add("legacy-reference")
        return result

    return ContentAudits(
        VisualAssets(session, request.app.state.settings, owner),
        protection_reader=protections,
        protect_asset=protect,
    )


router = content_router(bind_content_audits, session_dep=SessionDep, owner_dep=OwnerDep)
