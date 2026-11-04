"""Prepare project file scope at Assets and record the outcome in the source transaction."""

from contextlib import asynccontextmanager
from uuid import uuid4

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError


class ProjectLayouts:
    def __init__(self, connection, session, owner, app):
        self.connection, self.session, self.owner = connection, session, owner
        self.coordinator = app.state.reference_mutations
        self.delivery = app.state.reference_delivery

    def create_layout(self, project_id):
        return self.change(project_id, expected=-1, deleted=False)

    def delete_layout(self, project_id, expected):
        return self.change(project_id, expected=expected, deleted=True)

    async def prepare(self, project_id, expected):
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
                raise VideoEditorNotFoundError("剪辑项目不存在") from exc
            if exc.code == "asset_in_use":
                raise VideoEditorValidationError("项目素材仍被其他资源引用", code=exc.code) from exc
            raise VideoEditorUnavailableError("项目素材范围暂不可用") from exc
        except (CapabilityUnavailable, ProjectResourceError) as exc:
            raise VideoEditorUnavailableError("项目素材范围暂不可用") from exc

    @asynccontextmanager
    async def change(self, project_id, *, expected, deleted):
        await self.session.rollback()
        prepared = await self.prepare(project_id, expected)
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
        try:
            await self.delivery.deliver(self.owner, prepared.request_id)
        except (CapabilityDenied, CapabilityUnavailable):
            # The worker continues from the committed outcome after an unknown reply.
            pass
