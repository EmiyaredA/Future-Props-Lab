"""Website media composition: owned source lookup and short-lived credential revalidation."""

from fastapi import HTTPException

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.media_sources import StoredMediaSources
from studio.apps.media_rendering.previews import MediaPreviews
from studio.apps.media_rendering.processing import LocalMediaProcessor
from studio.apps.media_rendering.use_cases.read_media import ReadMedia
from studio.assembly.http_dependencies import require_studio_auth
from studio.contracts.asset_library.errors import AssetError


class WebsiteMediaAuthorization:
    def __init__(self, request, sessions):
        self.request, self.sessions = request, sessions

    async def ensure_active(self):
        try:
            async with self.sessions() as session:
                await require_studio_auth(self.request, session)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            raise AssetError(
                detail.get("message", "来源授权已撤销"),
                status=exc.status_code,
                code=detail.get("code", "source_authorization_revoked"),
            ) from exc


def bind_media(app, settings, sessions):
    sources = StoredMediaSources(sessions, AssetStorage(settings))
    processor = LocalMediaProcessor(
        MediaPreviews(settings),
        root=settings.runtime_path / ".tmp" / "media-inputs",
        maximum=settings.fpl_visual_asset_max_bytes,
    )
    app.state.media_authorization = lambda request: WebsiteMediaAuthorization(request, sessions)
    app.state.media_reads = lambda request: ReadMedia(
        sources,
        processor,
        app.state.media_authorization(request),
    )
