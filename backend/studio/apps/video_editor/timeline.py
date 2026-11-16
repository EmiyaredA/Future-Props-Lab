from __future__ import annotations

from sqlalchemy import select, update

from studio.apps.video_editor.clip_merging.context import operation_contexts
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.schemas import (
    VideoEditorTimelineOut,
)
from studio.apps.video_editor.storage.models import (
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTimeline,
)
from studio.apps.video_editor.timeline_read import VideoTimelineRead
from studio.apps.video_editor.use_cases.edit_timeline import EditTimeline
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


class VideoEditorTimelines(VideoTimelineRead):
    async def apply(self, project_id, body, *, assets):
        return await EditTimeline(self, assets).execute(project_id, body)

    async def replay(self, project_id, body):
        existing = (
            await self.session.execute(
                select(VideoEditorOperationBatch).where(
                    VideoEditorOperationBatch.project_id == project_id,
                    VideoEditorOperationBatch.owner_user_id == self.owner_user_id,
                    VideoEditorOperationBatch.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.base_revision != body.expected_revision or existing.operations != [
                op.model_dump(mode="json", by_alias=True, exclude_none=True)
                for op in body.operations
            ]:
                raise VideoEditorValidationError(
                    "requestId 已用于不同操作", code="request_id_reused"
                )
            # This API confirms the request, then returns the current snapshot.
            # result_revision identifies the accepted operation; it is deliberately
            # different from the returned revision after later edits.
            return await self.get(project_id)
        return None

    async def contexts(self, project_id, body, assets):
        return await operation_contexts(
            self.session, self.owner_user_id, assets, project_id, body.operations
        )

    async def commit(self, project_id, body, document):
        operations = [
            op.model_dump(mode="json", by_alias=True, exclude_none=True) for op in body.operations
        ]
        now = utc_now()
        result = await self.session.execute(
            update(VideoEditorTimeline)
            .where(
                VideoEditorTimeline.project_id == project_id,
                VideoEditorTimeline.revision == body.expected_revision,
            )
            .values(document=document, revision=body.expected_revision + 1, updated_at=now)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            replay = await self.replay(project_id, body)
            if replay is not None:
                return replay
            current = await self.row(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                self.out(current).model_dump(mode="json", by_alias=True),
            )
        self.session.add(
            VideoEditorOperationBatch(
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                request_id=body.request_id,
                base_revision=body.expected_revision,
                result_revision=body.expected_revision + 1,
                operations=operations,
            )
        )
        await self.session.execute(
            update(VideoEditorProject)
            .where(
                VideoEditorProject.id == project_id,
                VideoEditorProject.owner_user_id == self.owner_user_id,
            )
            .values(updated_at=now)
        )
        await self.session.commit()
        # The validated document is already the committed result. Returning it
        # avoids a second project/timeline read on every small edit such as a split.
        return VideoEditorTimelineOut(
            projectId=project_id,
            revision=body.expected_revision + 1,
            document=document,
            updatedAt=iso_utc(now),
        )
