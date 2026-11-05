"""Run and recover independently owned Galgame Annotation imports."""

import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import ValidationError
from sqlalchemy import select, text

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameAnnotationImportTask
from app.apps.galgame_workshop.schemas import GalgameAnnotationImportIn
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.project_errors import ProjectResourceError

from .annotation_clips import BATCH_SIZE, cut_batch, save_clips
from .annotation_original import fetch_original
from .annotation_preview import annotation_preview
from .annotation_publish import publish_annotation
from .assets_read import ProjectAssetReads
from .models import GalgameAnnotationAuthorization


class AnnotationImports(PollingTaskRunner):
    runner_name = "galgame-annotation-import"
    poll_interval_seconds = 2

    def __init__(self, state, uploads, root):
        super().__init__()
        self.state, self.uploads = state, uploads
        self.sessions = state.database.sessions
        self.staging = root.resolve() / ".annotation-work"

    async def recover(self):
        if self.staging.is_symlink():
            raise ValueError("标注导入暂存目录不能是符号链接")
        self.staging.mkdir(parents=True, exist_ok=True, mode=0o700)
        for path in self.staging.glob("job-*"):
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)

    async def next_task(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            return (
                await db.execute(
                    select(
                        GalgameAnnotationImportTask.id, GalgameAnnotationImportTask.owner_user_id
                    )
                    .join(
                        GalgameAnnotationAuthorization,
                        GalgameAnnotationAuthorization.task_id == GalgameAnnotationImportTask.id,
                    )
                    .where(
                        GalgameAnnotationImportTask.owner_user_id
                        == GalgameAnnotationAuthorization.owner_user_id,
                        GalgameAnnotationImportTask.status.in_(("queued", "running")),
                    )
                    .order_by(
                        GalgameAnnotationImportTask.updated_at, GalgameAnnotationImportTask.id
                    )
                    .limit(1)
                )
            ).one_or_none()

    async def update(self, owner, identity, status, phase, progress, *, error=None):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            task = await db.get(GalgameAnnotationImportTask, identity)
            if task is None or task.status not in {"queued", "running"}:
                return
            now = utc_now()
            task.status, task.progress, task.error = status, progress, error
            task.result_detail = {"phase": phase}
            task.revision += 1
            task.updated_at = now
            if task.started_at is None:
                task.started_at = now
            if status in {"failed", "conflict"}:
                task.finished_at = now
                authorization = await db.get(GalgameAnnotationAuthorization, identity)
                if authorization is not None:
                    await db.delete(authorization)
            await db.commit()

    async def process_once(self):
        selected = await self.next_task()
        if selected is None:
            return
        identity, owner = selected
        try:
            await self.update(owner, identity, "running", "cutting", 2)
            await self.execute(owner, identity)
        except RevisionConflictError:
            await self.update(owner, identity, "conflict", "conflict", 0, error="故事版本已变化")
        except ProjectResourceError as exc:
            if exc.status in {502, 503, 504}:
                await self.update(owner, identity, "running", "validating", 2, error=str(exc))
                raise
            status = "conflict" if exc.status == 409 else "failed"
            await self.update(owner, identity, status, status, 0, error=str(exc)[:4000])
        except (
            RuntimeError,
            OSError,
            TimeoutError,
            ValidationError,
            GalgameStoryDocumentInvalidError,
        ) as exc:
            await self.update(owner, identity, "failed", "failed", 0, error=str(exc)[:4000])

    async def execute(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            task = await db.get(GalgameAnnotationImportTask, identity)
            authorization = await db.get(GalgameAnnotationAuthorization, identity)
            if task is None or authorization is None or task.status != "running":
                return
            project = task.project_id
            body = GalgameAnnotationImportIn.model_validate(task.request_payload)
            path = f"{SOURCE}/{project}/annotation-imports"
            assertion = authorization.assertion
            files = ProjectAssetReads(db, owner, self.state.capabilities, assertion, "POST", path)
            preview = await annotation_preview(files, project, body)
            if not preview.ready:
                conflicts = {"source_revision_conflict", "story_revision_conflict"}
                status = 409 if any(issue.code in conflicts for issue in preview.issues) else 422
                raise ProjectResourceError(
                    "；".join(issue.message for issue in preview.issues),
                    "annotation_not_ready",
                    status,
                )
            await db.rollback()
            audit = await self.materialize(files, identity, project, body, preview)
            await self.update(owner, identity, "running", "saving", 95)
            await publish_annotation(
                files, self.state.reference_mutations, identity, project, body, preview, audit
            )

    async def materialize(self, files, identity, project, body, preview):
        audit = []
        with TemporaryDirectory(dir=self.staging, prefix="job-") as folder:
            directory = Path(folder)
            source = directory / "original-audio"
            await fetch_original(
                self.state.capabilities,
                files.assertion,
                files.source_path,
                project,
                preview.source_project_id,
                preview.source_asset_id,
                preview.source_checksum_sha256,
                source,
            )
            segments = preview.segments
            for offset in range(0, len(segments), BATCH_SIZE):
                clips = await cut_batch(
                    source,
                    directory,
                    segments[offset : offset + BATCH_SIZE],
                    body.requirements,
                    body.asset_prefix,
                    offset,
                )
                audit.extend(
                    [item async for item in save_clips(files, self.uploads, project, clips)]
                )
                for clip in clips:
                    clip.path.unlink()
                await self.update(
                    files.projects.owner,
                    identity,
                    "running",
                    "validating",
                    min(94, 2 + round(len(audit) / len(segments) * 90)),
                )
        return audit
