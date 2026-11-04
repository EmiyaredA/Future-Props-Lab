"""Request exact Motion bytes via Rendering's private transfer capability."""

from dataclasses import asdict

import httpx

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.video_assets import VideoAsset
from fpl_runtime.video_handoff import TRANSFERS


class MotionMedia:
    def __init__(self, client, peer):
        self.client, self.peer = client, peer

    async def prepare(self, owner, source):
        path = f"{TRANSFERS}/prepare/{source.remote_id}/{source.format}"
        try:
            reply = await self.client.get(
                "http://rendering:8080" + path,
                headers=self.peer.headers("GET", path, owner),
                timeout=httpx.Timeout(90, connect=5),
            )
            if reply.status_code == 404:
                raise VideoEditorNotFoundError("特效成片不存在")
            reply.raise_for_status()
            return asdict(ModelOutputDescription(**reply.json()))
        except (httpx.HTTPError, ValueError, TypeError):
            raise VideoEditorUnavailableError("特效成片暂不可用") from None

    async def transfer(self, intent, source):
        descriptor = ModelOutputDescription(**intent.output_descriptor)
        path = (
            f"{TRANSFERS}/{intent.id}/{intent.project_id}/{source.remote_id}/"
            f"{source.format}/{descriptor.fingerprint}"
        )
        headers = self.peer.headers("POST", path, intent.owner_user_id)
        headers["X-Fpl-Video-Output"] = descriptor.header()
        try:
            reply = await self.client.post(
                "http://rendering:8080" + path,
                headers=headers,
                timeout=httpx.Timeout(300, connect=5),
            )
            if reply.status_code == 404:
                raise VideoEditorNotFoundError("特效成片或剪辑项目不存在")
            if reply.status_code in {401, 403, 413, 422}:
                raise ValueError("特效成片交接被拒绝")
            reply.raise_for_status()
            output = VideoAsset.model_validate(reply.json())
            if (
                output.original_filename != descriptor.filename
                or output.byte_size != descriptor.byte_size
                or output.media_kind != "video"
            ):
                raise ValueError("交接回执与原成片不符")
            return output
        except httpx.HTTPError:
            raise VideoEditorUnavailableError("特效成片交接结果暂未确认") from None
