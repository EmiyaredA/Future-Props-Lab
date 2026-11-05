"""Request-bound remote asset borrowing and authorization recheck."""

from contextlib import asynccontextmanager

from studio.apps.media_rendering.inputs import input_file
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.files.borrowed_media import FileMediaContent


class RemoteMediaSources:
    def __init__(self, *, settings, capabilities, owner, assertion, method, path):
        self.settings, self.capabilities = settings, capabilities
        self.owner = owner
        self.assertion, self.method, self.path = assertion, method, path

    @asynccontextmanager
    async def borrow(self, owner, asset_id):
        if owner != self.owner:
            raise AssetError("文件不存在", status=404, code="not_found")
        async with input_file(
            settings=self.settings,
            capabilities=self.capabilities,
            owner=owner,
            assertion=self.assertion,
            method=self.method,
            path=self.path,
            asset_id=asset_id,
        ) as (info, path):
            with FileMediaContent(info, path) as content:
                yield content


class RemoteMediaAuthorization:
    def __init__(self, identity, *, assertion, method, path):
        self.identity, self.assertion, self.method, self.path = identity, assertion, method, path

    async def ensure_active(self):
        active = await self.identity.status(
            assertion=self.assertion, method=self.method, path=self.path
        )
        if active is None:
            raise AssetError("身份服务暂不可用", status=503, code="identity_unavailable")
        if not active:
            raise AssetError("来源授权已撤销", status=401, code="source_authorization_revoked")
