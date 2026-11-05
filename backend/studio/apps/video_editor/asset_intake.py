"""Persist Video's upload intent, then register Assets' durable receipt once."""

from uuid import uuid4

import httpx
from sqlalchemy import select, text, update

from app.capabilities.asset_store.errors import AssetError
from studio.apps.video_editor.asset_output import asset_output
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorProject
from studio.apps.video_editor.storage.service_models import VideoAssetIntake
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.video_editor.video_assets import PREFIX, WRITE_PURPOSE, VideoAsset
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

from .media_registration import register_media

ASSETS = "http://assets:8080"


class AssetIntakes(PollingTaskRunner):
    runner_name = "video-asset-intakes"
    poll_interval_seconds = 2

    def __init__(self, sessions, capabilities):
        super().__init__()
        self.sessions, self.capabilities = sessions, capabilities

    async def recover(self):
        # Unconfirmed writes can be queried by their exact persisted authority.
        pass

    async def reserve(self, request, owner, project_id, action, digest, count):
        identity = uuid4().hex
        target = f"{PREFIX}/{project_id}/writes/{identity}/{action}/{digest}"
        grant = RequestGrant(
            "video", WRITE_PURPOSE, "POST", request.url.path, "assets", "POST", target
        )
        try:
            assertion = await self.capabilities.authorize_request(
                request.state.service_assertion, grant
            )
        except (CapabilityDenied, CapabilityUnavailable):
            raise VideoEditorUnavailableError("素材写入授权暂不可用") from None
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            if await session.get(VideoEditorProject, project_id) is None:
                raise VideoEditorNotFoundError("剪辑项目不存在")
            pending = VideoAssetIntake(
                id=identity,
                owner_user_id=owner,
                project_id=project_id,
                target_path=target,
                assertion=assertion,
                expected_count=count,
            )
            session.add(pending)
            await session.commit()
        return pending

    def decode(self, pending, response):
        entries = [VideoAsset.model_validate(item) for item in response.json()["items"]]
        if len(entries) != pending.expected_count or len({item.id for item in entries}) != len(
            entries
        ):
            raise ValueError("剪辑素材回执条数不符")
        return entries

    async def write(self, pending, *, headers=None, content=None, body=None):
        try:
            response = await self.capabilities.client.post(
                ASSETS + pending.target_path,
                headers={**(headers or {}), HEADER: pending.assertion},
                content=content,
                json=body,
                timeout=httpx.Timeout(180, connect=5),
            )
            if response.status_code in {401, 403, 404, 409, 413, 415, 422}:
                await self.reject(pending)
                error = response.json()
                raise AssetError(
                    str(error.get("detail", "素材写入被拒绝")),
                    code=str(error.get("code", "invalid_asset")),
                    status=response.status_code,
                )
            response.raise_for_status()
            entries = self.decode(pending, response)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise VideoEditorUnavailableError("素材写入回执尚未确认") from None
        return await self.settle(pending, entries)

    async def reject(self, pending):
        async with self.sessions(info={"owner_user_id": pending.owner_user_id}) as session:
            await session.execute(
                update(VideoAssetIntake)
                .where(VideoAssetIntake.id == pending.id, VideoAssetIntake.state == "pending")
                .values(state="rejected", assertion="")
            )
            await session.commit()

    async def settle(self, pending, entries):
        owner, project = pending.owner_user_id, pending.project_id
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(VideoAssetIntake, pending.id)
            if current is None or await session.get(VideoEditorProject, project) is None:
                raise VideoEditorNotFoundError("剪辑项目不存在")
            outputs = []
            for item in entries:
                metadata = await session.get(VideoEditorAssetMetadata, item.id)
                if metadata is None:
                    metadata = register_media(session, owner, project, item.id)
                    await session.flush()
                elif metadata.project_id != project:
                    raise VideoEditorUnavailableError("素材写入回执项目不符")
                outputs.append(asset_output(project, item, metadata))
            current.state, current.assertion = "settled", ""
            await session.commit()
        return outputs

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = await session.scalar(
                select(VideoAssetIntake)
                .where(VideoAssetIntake.state == "pending")
                .order_by(VideoAssetIntake.checked_at, VideoAssetIntake.id)
                .limit(1)
            )
        if pending is None:
            return
        try:
            response = await self.capabilities.client.get(
                ASSETS + pending.target_path, headers={HEADER: pending.assertion}
            )
            if response.status_code != 404:
                response.raise_for_status()
                await self.settle(pending, self.decode(pending, response))
        except VideoEditorNotFoundError:
            pass  # Project deletion won the race and fences the Assets file scope.
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("素材写入回执尚未确认") from exc
        finally:
            async with self.sessions(info={"owner_user_id": pending.owner_user_id}) as session:
                await session.execute(
                    update(VideoAssetIntake)
                    .where(VideoAssetIntake.id == pending.id, VideoAssetIntake.state == "pending")
                    .values(checked_at=utc_now())
                )
                await session.commit()
