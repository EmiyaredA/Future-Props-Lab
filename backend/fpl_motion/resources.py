"""Use owned transactions and signed project file metadata during document saves."""

from contextlib import asynccontextmanager

import httpx

from app.apps.motion_compositor.projects import MotionInvalid, MotionUnavailable
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.motion_assets import MAX_IDS, PURPOSE, MotionAsset, MotionAssetQuery


class ProjectResources:
    def __init__(self, connection, session, capabilities):
        self.connection, self.session, self.capabilities = connection, session, capabilities

    @asynccontextmanager
    async def create_layout(self, _identity):
        try:
            yield
        except BaseException:
            await self.session.rollback()
            raise
        await self.session.commit()

    async def validate_assets(self, project_id, document):
        ids = sorted({layer.asset_id for layer in document.layers if layer.asset_id})
        if not ids:
            return
        await self.session.rollback()
        assets = {}
        for offset in range(0, len(ids), MAX_IDS):
            try:
                query = MotionAssetQuery(asset_ids=ids[offset : offset + MAX_IDS])
                path = query.path(project_id)
            except ValueError:
                raise MotionInvalid("文档引用了不属于此项目的素材") from None
            grant = RequestGrant(
                "motion",
                PURPOSE,
                self.connection.method,
                self.connection.url.path,
                "assets",
                "GET",
                path,
            )
            try:
                assertion = self.connection.state.service_assertion
                proof = await self.capabilities.authorize_request(assertion, grant)
                response = await self.capabilities.client.get(
                    "http://assets:8080" + path,
                    params={"id": query.asset_ids},
                    headers={"X-Fpl-Context": proof},
                )
                if response.status_code == 404:
                    raise MotionInvalid("文档引用了不属于此项目的素材")
                response.raise_for_status()
                rows = [MotionAsset.model_validate(row) for row in response.json()["items"]]
                if [row.id for row in rows] != query.asset_ids:
                    raise ValueError("motion metadata mismatch")
            except (
                CapabilityDenied,
                CapabilityUnavailable,
                httpx.HTTPError,
                ValueError,
                TypeError,
                KeyError,
            ):
                raise MotionUnavailable("素材验证暂不可用") from None
            assets.update({row.id: row for row in rows})
        if any(
            assets[layer.asset_id].media_kind != layer.kind
            for layer in document.layers
            if layer.asset_id
        ):
            raise MotionInvalid("素材类型与图层类型不一致")
