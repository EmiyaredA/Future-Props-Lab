"""Use owned transactions and signed project file metadata during document saves."""

from contextlib import asynccontextmanager
from uuid import uuid4

import httpx

from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionUnavailable
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_assets import (
    MAX_IDS,
    PURPOSE,
    MotionAsset,
    MotionAssetQuery,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError


class ProjectResources:
    def __init__(self, connection, session, capabilities, coordinator, *, owner):
        self.connection, self.session, self.capabilities = connection, session, capabilities
        self.coordinator = coordinator
        self.owner = owner

    def create_layout(self, project_id):
        return self.change_layout(project_id, -1, deleted=False)

    def delete_layout(self, project_id, expected):
        return self.change_layout(project_id, expected, deleted=True)

    async def prepare_layout(self, project_id, expected):
        try:
            return await self.coordinator.prepare(
                owner=self.owner,
                assertion=self.connection.state.service_assertion,
                source_method=self.connection.method,
                source_path=self.connection.url.path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="project",
                    resource_id=project_id,
                    expected_resource_revision=expected,
                    asset_ids=[],
                ),
            )
        except CapabilityDenied as exc:
            if exc.status == 404:
                raise MotionNotFound("特效项目不存在") from exc
            if exc.code == "asset_in_use":
                raise MotionInvalid("项目素材仍被其他资源引用") from exc
            raise MotionUnavailable("项目素材保留结果暂不可用") from exc
        except (CapabilityUnavailable, ProjectResourceError) as exc:
            raise MotionUnavailable("项目素材保留结果未确认") from exc

    @asynccontextmanager
    async def change_layout(self, project_id, expected, *, deleted):
        await self.session.rollback()
        prepared = await self.prepare_layout(project_id, expected)
        try:
            yield
            await self.coordinator.record(
                self.session, prepared, resource_revision=expected + 1, deleted=deleted
            )
        except BaseException:
            await self.session.rollback()
            await self.coordinator.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()

    async def describe_assets(self, project_id, identities):
        ids = sorted(identities)
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
        return assets

    async def validate_assets(self, project_id, document):
        ids = {layer.asset_id for layer in document.layers if layer.asset_id}
        if not ids:
            return
        assets = await self.describe_assets(project_id, ids)
        if any(
            assets[layer.asset_id].media_kind != layer.kind
            for layer in document.layers
            if layer.asset_id
        ):
            raise MotionInvalid("素材类型与图层类型不一致")
