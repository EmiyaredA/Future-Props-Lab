"""Coordinate Galgame metadata CAS and the owned Assets file mutation."""

import re
from uuid import uuid4

from sqlalchemy import select, text

from app.apps.galgame_workshop.assets.asset_support import asset_edit_values, galgame_asset_out
from app.apps.galgame_workshop.models import GalgameAssetMetadata
from app.capabilities.asset_store.errors import AssetError
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.asset_references import GalgameFileMutation, PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.library_assets import ID
from fpl_runtime.project_errors import ProjectResourceError

from .models import GalgameStoryReferenceMutation, GalgameUploadIntake


class AssetEdits:
    def __init__(self, request, files, owner):
        self.request, self.files, self.owner = request, files, owner
        self.session = files.session
        self.references = request.app.state.reference_mutations
        self.delivery = request.app.state.reference_delivery

    async def pending(self, project_id, asset_id):
        if not re.fullmatch(ID, asset_id):
            raise ProjectResourceError("工程素材不存在")
        await self.files.projects.row(project_id)
        rows = await self.session.scalars(
            select(GalgameStoryReferenceMutation.request_id)
            .where(
                GalgameStoryReferenceMutation.state == "commit",
                GalgameStoryReferenceMutation.change["resource_kind"]
                .as_string()
                .in_(("file-name", "file-removal")),
                GalgameStoryReferenceMutation.change["resource_id"].as_string() == asset_id,
                GalgameStoryReferenceMutation.change["galgame_file_mutation"][
                    "project_id"
                ].as_string()
                == project_id,
            )
            .order_by(GalgameStoryReferenceMutation.created_at)
        )
        identities = list(rows)
        await self.session.rollback()
        for identity in identities:
            await self.settle(identity)

    async def current(self, project_id, asset_id, expected):
        await self.files.projects.row(project_id)
        records = await self.files.asset_records(
            project_id,
            (),
            newest_first=False,
            project_file_id=asset_id,
        )
        if not records:
            raise ProjectResourceError("工程素材不存在")
        asset, metadata = records[0]
        if asset.revision != expected:
            raise RevisionConflictError(
                expected,
                asset.revision,
                galgame_asset_out(asset, metadata).model_dump(mode="json", by_alias=True),
            )
        return asset, metadata

    async def prepare(self, project_id, asset_id, expected, *, deleting=False, display_name=None):
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="file-removal" if deleting else "file-name",
            resource_id=asset_id,
            expected_resource_revision=expected,
            asset_ids=[],
            galgame_file_mutation=GalgameFileMutation(
                project_id=project_id, display_name=display_name
            ),
        )
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.request.state.service_assertion,
                source_method=self.request.method,
                source_path=self.request.url.path,
                change=change,
            )
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            await self.references.abandon_preparation(self.session, self.owner, change)
            if isinstance(exc, CapabilityDenied):
                if exc.code == "asset_in_use":
                    story = await self.files.projects.story(project_id)
                    references = self.files._story_references_by_file(story.document).get(
                        asset_id, []
                    )
                    raise AssetError(
                        "工程素材仍被故事引用" if references else "工程素材仍被应用或历史引用",
                        code="asset_in_use",
                        status=409,
                        detail={"references": references},
                    ) from exc
                if exc.status == 404:
                    raise ProjectResourceError("工程素材不存在") from exc
                if exc.status == 409:
                    await self.current(project_id, asset_id, expected)
            raise ProjectResourceError(
                "素材更新暂不可确认", "asset_update_unconfirmed", 503
            ) from exc

    async def check_path(self, project_id, asset_id, virtual_path):
        collision = await self.session.scalar(
            select(GalgameAssetMetadata.asset_id)
            .where(
                GalgameAssetMetadata.project_id == project_id,
                GalgameAssetMetadata.virtual_path == virtual_path,
                GalgameAssetMetadata.asset_id != asset_id,
            )
            .limit(1)
        )
        reservations = await self.session.scalars(
            select(GalgameUploadIntake.planned).where(
                GalgameUploadIntake.project_id == project_id,
                GalgameUploadIntake.state.in_(("reserved", "pending")),
            )
        )
        if collision or any(
            entry["virtual_path"] == virtual_path for group in reservations for entry in group
        ):
            raise ProjectResourceError("虚拟路径已被其他文件使用", "virtual_path_conflict", 409)

    async def patch(self, project_id, asset_id, body):
        await self.pending(project_id, asset_id)
        asset, metadata = await self.current(project_id, asset_id, body.expected_revision)
        display_name, category, path = asset_edit_values(asset, metadata, body)
        await self.check_path(project_id, asset_id, path)
        await self.session.rollback()
        prepared = await self.prepare(
            project_id,
            asset_id,
            body.expected_revision,
            display_name=display_name if body.display_name is not None else None,
        )

        async def apply():
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.files.projects.row(project_id)
            await self.check_path(project_id, asset_id, path)
            metadata = await self.session.get(GalgameAssetMetadata, asset_id)
            if metadata is None:
                metadata = GalgameAssetMetadata(
                    asset_id=asset_id,
                    project_id=project_id,
                    transcript_status="pending" if asset.media_kind == "audio" else "ready",
                )
                self.session.add(metadata)
            elif metadata.project_id != project_id:
                raise ProjectResourceError("素材元数据不属于当前项目", "asset_metadata_scope", 409)
            metadata.category, metadata.virtual_path = category, path
            if body.packaging_policy is not None:
                metadata.packaging_policy = body.packaging_policy
            await self.session.flush()
            projected = asset.model_copy(
                update={
                    "display_name": display_name,
                    "revision": body.expected_revision + 1,
                }
            )
            return galgame_asset_out(projected, metadata)

        result = await self.references.commit_source(self.session, prepared, apply)
        await self.settle(prepared.request_id)
        # Assets owns the version and timestamp of the committed label.
        rows = await self.files.asset_records(
            project_id,
            (),
            newest_first=False,
            project_file_id=asset_id,
        )
        return galgame_asset_out(*rows[0]) if rows else result

    async def delete(self, project_id, asset_id, expected):
        await self.pending(project_id, asset_id)
        await self.current(project_id, asset_id, expected)
        await self.session.rollback()
        prepared = await self.prepare(project_id, asset_id, expected, deleting=True)
        try:
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.files.projects.row(project_id)
            metadata = await self.session.get(GalgameAssetMetadata, asset_id)
            if metadata is not None:
                if metadata.project_id != project_id:
                    raise ProjectResourceError(
                        "素材元数据不属于当前项目", "asset_metadata_scope", 409
                    )
                await self.session.delete(metadata)
            await self.references.record(
                self.session, prepared, resource_revision=expected + 1, deleted=True
            )
        except BaseException:
            await self.session.rollback()
            await self.references.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()
        await self.settle(prepared.request_id)

    async def settle(self, identity):
        try:
            await self.delivery.deliver(self.owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise ProjectResourceError("素材更新正在确认", "asset_update_unconfirmed", 503) from exc
