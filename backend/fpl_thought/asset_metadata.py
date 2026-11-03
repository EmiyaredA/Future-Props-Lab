"""Request-bound Assets transport. File paths never cross the service boundary."""

import contextlib
import time
from dataclasses import asdict

import httpx
from pydantic import TypeAdapter

from app.apps.thought_workshop.asset_metadata import LibraryAsset
from app.apps.thought_workshop.errors import ThoughtError
from fpl_runtime.delegation import RequestGrant, permitted
from fpl_runtime.thought_assets import AssetDescription, AssetQuery

DESCRIPTIONS = TypeAdapter(list[AssetDescription])


class HttpAssetMetadata:
    def __init__(
        self,
        *,
        assertion,
        source_method,
        source_path,
        credential,
        catalog,
        identity_url="http://identity:8080",
        assets_url="http://assets:8080",
        transport=None,
        maximum_bytes=1024 * 1024 * 1024,
    ):
        self.assertion, self.method, self.path = assertion, source_method, source_path
        self.credential, self.catalog = credential, catalog
        self.identity_url, self.assets_url, self.transport = identity_url, assets_url, transport
        self.maximum_bytes = maximum_bytes
        self.snapshots = {}

    def client(self):
        return httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            transport=self.transport,
            timeout=httpx.Timeout(30, read=60),
        )

    async def authorize(self, client, method, path):
        grant = RequestGrant(
            "thought", "thought.library.read", self.method, self.path, "assets", method, path
        )
        if not permitted(grant, self.catalog):
            raise ThoughtError("素材读取请求未获授权", 403, "asset_read_forbidden")
        response = await client.post(
            self.identity_url + "/_internal/v1/authorization/delegate",
            headers={"Authorization": "Bearer " + self.credential},
            json={**asdict(grant), "assertion": self.assertion},
        )
        if response.status_code in {401, 403}:
            raise ThoughtError(
                "素材读取授权已失效", response.status_code, "asset_authorization_revoked"
            )
        if response.status_code != 200:
            raise ValueError("asset authorization unavailable")
        token = response.json()["assertion"]
        if not isinstance(token, str) or not 1 <= len(token) <= 8192:
            raise ValueError("invalid asset assertion")
        return token

    @staticmethod
    def check(response):
        if response.status_code == 404:
            raise ThoughtError("素材不存在或不属于当前公共文件库", 404, "not_found")
        if response.status_code in {401, 403}:
            raise ThoughtError(
                "素材读取授权已失效", response.status_code, "asset_authorization_revoked"
            )
        if response.status_code == 409:
            raise ThoughtError("素材版本已变化，请重新导出", 409, "asset_version_changed")
        if response.status_code != 200:
            raise ValueError("asset transport unavailable")

    async def describe(self, asset_ids):
        if not asset_ids:
            return {}
        if set(asset_ids) <= self.snapshots.keys():
            selected = {id: self.snapshots[id] for id in asset_ids}
            if any(time.monotonic() - captured > 5 for _row, captured in selected.values()):
                raise ThoughtError("素材校验快照已过期，请重新提交", 503, "asset_metadata_expired")
            return {id: row for id, (row, _captured) in selected.items()}
        query = AssetQuery(asset_ids=list(asset_ids))
        try:
            async with self.client() as client:
                token = await self.authorize(client, "POST", query.path)
                response = await client.post(
                    self.assets_url + query.path,
                    headers={"X-Fpl-Context": token},
                    json=query.model_dump(),
                )
                self.check(response)
                if len(response.content) > 8 * 1024 * 1024:
                    raise ValueError("asset metadata too large")
                rows = DESCRIPTIONS.validate_python(response.json()["items"])
            if len(rows) != len(asset_ids) or {row.id for row in rows} != set(asset_ids):
                raise ValueError("asset response not bound to query")
            result = {row.id: LibraryAsset(**row.model_dump()) for row in rows}
            captured = time.monotonic()
            self.snapshots.update({id: (row, captured) for id, row in result.items()})
            return result
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise ThoughtError("素材目录暂不可用", 503, "asset_metadata_unavailable") from None

    async def download(self, asset, target):
        description = AssetDescription(**asdict(asset))
        if description.byte_size > self.maximum_bytes:
            raise ThoughtError("素材超过导出大小限制", 413, "asset_too_large")
        created = False
        try:
            async with self.client() as client:
                token = await self.authorize(client, "GET", description.content_path)
                async with client.stream(
                    "GET",
                    self.assets_url + description.content_path,
                    headers={"X-Fpl-Context": token},
                ) as response:
                    self.check(response)
                    if (
                        response.headers.get("Content-Encoding", "identity") != "identity"
                        or int(response.headers["Content-Length"]) != description.byte_size
                        or int(response.headers["X-Fpl-File-Revision"]) != description.revision
                    ):
                        raise ValueError("asset content metadata changed")
                    total = 0
                    with target.open("xb") as output:
                        created = True
                        async for chunk in response.aiter_bytes():
                            total += len(chunk)
                            if total > description.byte_size:
                                raise ValueError("asset content exceeds description")
                            output.write(chunk)
                    if total != description.byte_size:
                        raise ValueError("asset content incomplete")
            return target
        except BaseException as exc:
            if created:
                with contextlib.suppress(OSError):
                    target.unlink()
            if isinstance(exc, (httpx.HTTPError, ValueError, KeyError, TypeError)):
                raise ThoughtError("素材传输未完成", 503, "asset_content_unavailable") from None
            raise
