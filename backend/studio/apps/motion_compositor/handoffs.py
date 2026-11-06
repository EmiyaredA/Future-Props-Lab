"""Authorize transferring a completed Motion movie into one owned Video project."""

from uuid import UUID, uuid4

import httpx

from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionUnavailable
from studio.apps.motion_compositor.schemas import HandoffOut
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.document import MotionComposition
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.video_handoff import HANDOFFS, PURPOSE, MotionHandoff
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.ids import new_id

from .exports import Exports


async def transfer(request, projects, project, task_id, body):
    exports = Exports(projects)
    task = await exports.task(project, task_id)
    document = MotionComposition.model_validate(task.snapshot_document)
    start = int(task.request_payload["startFrame"])
    end = int(task.request_payload.get("endFrame") or document.settings.duration_frames)
    duration = round((end - start) * 1_000_000 / document.settings.fps)
    binding = await exports.output(project, task_id, body.format)
    target = body.target_project_id or new_id()
    try:
        if str(UUID(target)) != target:
            raise ValueError
    except ValueError:
        raise MotionNotFound("剪辑项目不存在") from None
    new_title = body.new_project_title.strip() if body.new_project_title is not None else None
    if new_title is not None and not 1 <= len(new_title) <= 120:
        raise MotionInvalid("剪辑项目名称无效")
    descriptor = MotionHandoff(
        remote_id=binding.remote_id,
        format=body.format,
        duration_us=duration,
        new_title=new_title,
    )
    raw = descriptor.model_dump_json().encode()
    action = "new" if new_title is not None else "existing"
    path = f"{HANDOFFS}/{project}/{task_id}/{uuid4().hex}/{target}/{action}/{sha256(raw)}"
    capabilities = request.app.state.motion_capabilities
    grant = RequestGrant("motion", PURPOSE, "POST", request.url.path, "video", "POST", path)
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        client = capabilities.client
        try:
            reply = await client.post(
                "http://video:8080" + path,
                content=raw,
                headers={HEADER: token},
                timeout=httpx.Timeout(180, connect=5),
            )
        except httpx.TransportError:
            reply = await client.get("http://video:8080" + path, headers={HEADER: token})
            if reply.status_code == 404:
                raise MotionUnavailable("剪辑交接结果暂未确认") from None
        if reply.status_code == 404:
            raise MotionNotFound("剪辑目标或导出文件不存在")
        if reply.status_code == 422:
            raise MotionInvalid("剪辑交接内容无效")
        reply.raise_for_status()
        return HandoffOut.model_validate(reply.json())
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
        raise MotionUnavailable("剪辑交接结果暂未确认") from None
