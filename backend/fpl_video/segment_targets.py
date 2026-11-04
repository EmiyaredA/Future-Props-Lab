"""Read the exact existing Visual canvas revision before freezing a segment task."""

import httpx

from app.apps.video_editor.errors import VideoEditorUnavailableError, VideoEditorValidationError
from app.runtime.ids import new_id
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.video_segment_handoff import TARGET_PURPOSE, TARGETS, SegmentTarget


async def plan_target(request, target):
    if request.app.state.segment_handoff_delivery is None:
        raise VideoEditorUnavailableError("独立工作坊的分段交接暂不可用")
    if target.project_id is None:
        return SegmentTarget(project_id=new_id(), new_title=target.new_project_title)

    destination = f"{TARGETS}/{target.project_id}"
    grant = RequestGrant(
        "video", TARGET_PURPOSE, "POST", request.url.path, "visual", "GET", destination
    )
    capabilities = request.app.state.capabilities
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        result = await capabilities.client.get(
            "http://visual:8080" + destination, headers={HEADER: token}
        )
        if result.status_code == 404:
            raise VideoEditorValidationError("目标工作坊项目或画布不存在", code="target_not_found")
        result.raise_for_status()
        return SegmentTarget(
            project_id=target.project_id, expected_revision=result.json()["revision"]
        )
    except (httpx.HTTPError, CapabilityDenied, CapabilityUnavailable, KeyError, ValueError):
        raise VideoEditorUnavailableError("目标工作坊画布暂不可用") from None
