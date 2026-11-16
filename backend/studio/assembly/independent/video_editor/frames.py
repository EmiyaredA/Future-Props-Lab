"""Construct the request-owned standalone frame adapters."""

from studio.apps.video_editor.clients.frame_renderer import HttpFrameRenderer
from studio.apps.video_editor.frame_requests import FrameRequests
from studio.apps.video_editor.storage.frame_reads import FrameTimelineRead
from studio.apps.video_editor.timeline_media import TimelineMedia


def frame_requests(request, session, owner):
    capabilities = request.app.state.capabilities
    return FrameRequests(
        FrameTimelineRead(session, owner),
        TimelineMedia(request, session, owner, capabilities),
        HttpFrameRenderer(
            capabilities, assertion=request.state.service_assertion, source_path=request.url.path
        ),
    )
