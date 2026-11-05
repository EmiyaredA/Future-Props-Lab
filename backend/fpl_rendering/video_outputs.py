"""Publish one digest-bound finished file into its Video Assets scope."""

import httpx
from anyio import open_file

from fpl_runtime.video_exports import OUTPUTS


class VideoOutputs:
    def __init__(self, client, peer):
        self.client, self.peer = client, peer

    @staticmethod
    def path(project, request_id, descriptor):
        return f"{OUTPUTS}/{project}/{request_id}/{descriptor.fingerprint}"

    async def lookup(self, owner, project, request_id, descriptor):
        path = self.path(project, request_id, descriptor)
        return await self.client.get(
            "http://assets:8080" + path,
            headers=self.peer.headers("GET", path, owner),
        )

    async def publish(self, owner, project, request_id, descriptor, source):
        path = self.path(project, request_id, descriptor)
        headers = {
            **self.peer.headers("POST", path, owner),
            "Content-Length": str(descriptor.byte_size),
            "X-Fpl-Video-Output": descriptor.header(),
        }

        async def stream():
            async with await open_file(source, "rb") as handle:
                while chunk := await handle.read(1024 * 1024):
                    yield chunk

        return await self.client.post(
            "http://assets:8080" + path,
            content=stream(),
            headers=headers,
            timeout=httpx.Timeout(300, connect=5),
        )
