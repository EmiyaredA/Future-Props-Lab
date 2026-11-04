"""Presentation access to account-library assets and durable reference outcomes."""

from uuid import uuid4

import httpx

from app.apps.presentation_workshop.asset_references import document_references, validate_assets
from app.apps.presentation_workshop.project_errors import PresentationError
from app.capabilities.asset_store.svg import MAX_SVG_BYTES, normalize_svg
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.presentation_assets import MAX_IDS, PURPOSE, PresentationAsset, PresentationQuery
from fpl_runtime.project_errors import ProjectResourceError

ASSETS = "http://assets:8080"


class ProjectAssets:
    def __init__(self, connection, capabilities):
        self.connection, self.capabilities = connection, capabilities
        self.monochrome_results = {}

    async def _headers(self, target):
        grant = RequestGrant(
            "presentation",
            PURPOSE,
            self.connection.method,
            self.connection.url.path,
            "assets",
            "GET",
            target,
        )
        token = await self.capabilities.authorize_request(
            self.connection.state.service_assertion, grant
        )
        return {"X-Fpl-Context": token, "Accept-Encoding": "identity"}

    async def assets(self, document):
        ids = sorted(document_references(document))
        rows = []
        for start in range(0, len(ids), MAX_IDS):
            query = PresentationQuery(asset_ids=ids[start : start + MAX_IDS])
            try:
                response = await self.capabilities.client.get(
                    ASSETS + query.path,
                    params={"id": query.asset_ids},
                    headers=await self._headers(query.path),
                )
                if response.status_code == 404:
                    raise PresentationError(
                        "图片不存在或不属于当前账号的公共文件库", 404, "not_found"
                    )
                response.raise_for_status()
                batch = [
                    PresentationAsset.model_validate(item) for item in response.json()["items"]
                ]
                if [item.id for item in batch] != query.asset_ids:
                    raise ValueError("asset metadata mismatch")
            except (
                CapabilityDenied,
                CapabilityUnavailable,
                httpx.HTTPError,
                ValueError,
                KeyError,
                TypeError,
            ):
                raise PresentationError("素材描述暂不可用", 503, "asset_unavailable") from None
            rows.extend(batch)
        return await validate_assets(document, rows, monochrome=self.monochrome)

    async def monochrome(self, asset):
        if asset.id not in self.monochrome_results:
            self.monochrome_results[asset.id] = await self._read_monochrome(asset)
        return self.monochrome_results[asset.id]

    async def _read_monochrome(self, asset):
        try:
            if asset.byte_size > MAX_SVG_BYTES:
                raise ValueError("SVG exceeds the published limit")
            body = bytearray()
            async with self.capabilities.client.stream(
                "GET",
                ASSETS + asset.content_path,
                headers=await self._headers(asset.content_path),
            ) as response:
                if response.status_code == 409:
                    raise PresentationError("素材版本已变化，请重试", 409, "source_changed")
                response.raise_for_status()
                if (
                    response.headers.get("Content-Encoding", "identity") != "identity"
                    or response.headers.get("X-Fpl-File-Revision") != str(asset.revision)
                    or response.headers.get("Content-Type") != "image/svg+xml"
                    or int(response.headers["Content-Length"]) != asset.byte_size
                ):
                    raise ValueError("asset headers mismatch")
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > asset.byte_size:
                        raise ValueError("asset size mismatch")
            if len(body) != asset.byte_size:
                raise ValueError("asset size mismatch")
            return normalize_svg(body.decode())["monochrome"]
        except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError, KeyError):
            raise PresentationError("矢量素材暂不可用", 503, "asset_unavailable") from None


class ProjectReferences:
    def __init__(self, connection, session, coordinator):
        self.connection, self.session, self.coordinator = connection, session, coordinator

    async def prepare(self, project_id, expected, asset_ids):
        try:
            return await self.coordinator.prepare(
                owner=self.session.info["owner_user_id"],
                assertion=self.connection.state.service_assertion,
                source_method=self.connection.method,
                source_path=self.connection.url.path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="project",
                    resource_id=project_id,
                    expected_resource_revision=expected,
                    asset_ids=asset_ids,
                ),
            )
        except CapabilityDenied as exc:
            if exc.status == 404:
                raise PresentationError("素材不存在", 404, "not_found") from exc
            if exc.code == "reference_projection_required":
                raise PresentationError("素材引用尚未核验", 503, "retention_unconfirmed") from exc
            raise PresentationError("素材引用准备被拒绝", exc.status, "retention_denied") from exc
        except (CapabilityUnavailable, ProjectResourceError) as exc:
            raise PresentationError("素材引用结果未确认", 503, "retention_unconfirmed") from exc

    async def record(self, session, prepared, **result):
        await self.coordinator.record(session, prepared, **result)

    async def abort(self, session, prepared):
        await self.coordinator.abort_after_rollback(session, prepared)
