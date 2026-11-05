"""Request-scoped media inputs and authorization around the shared read use case."""

from studio.apps.media_rendering.clients.media_sources import (
    RemoteMediaAuthorization,
    RemoteMediaSources,
)
from studio.apps.media_rendering.processing import LocalMediaProcessor
from studio.apps.media_rendering.use_cases.read_media import ReadMedia


def bind_media_reads(app):
    state = app.state
    processor = LocalMediaProcessor(
        state.media,
        root=state.settings.runtime_path / ".tmp" / "media-inputs",
        maximum=state.settings.max_input_bytes,
    )

    def reads(request):
        grant = dict(
            assertion=request.state.service_assertion, method=request.method, path=request.url.path
        )
        return ReadMedia(
            RemoteMediaSources(
                settings=state.settings,
                capabilities=state.capabilities,
                owner=request.state.service_actor.user_id,
                **grant,
            ),
            processor,
            RemoteMediaAuthorization(state.identity, **grant),
        )

    state.media_reads = reads
