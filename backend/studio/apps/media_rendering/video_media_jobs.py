"""Own derived editor media, with restart-safe processing and bounded originals."""

from pathlib import Path
from shutil import rmtree
from tempfile import TemporaryDirectory

from anyio.to_thread import run_sync
from sqlalchemy import select, text, update

from studio.apps.media_rendering.local.video_derivatives import prepare_media, probe_media
from studio.apps.media_rendering.storage.file_paths import sync_directory, sync_files
from studio.apps.media_rendering.storage.service_models import VideoMediaJob
from studio.contracts.video_editor.video_processing import MediaJobOut
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner

from .video_originals import download_original


def media_folder(settings, owner, job_id):
    account = settings.account_path(owner)
    root = account / "video-media" / job_id
    if root.is_symlink() or not root.resolve().is_relative_to(account):
        raise ValueError("剪辑处理目录无效")
    return root


class VideoJobs(PollingTaskRunner):
    runner_name = "rendering-video-media"
    poll_interval_seconds = 1

    def __init__(self, *, database, settings, identity, client, originals):
        super().__init__()
        self.database, self.settings, self.identity = database, settings, identity
        self.client, self.originals = client, originals

    def session(self, owner):
        return self.database.sessions(info={"owner_user_id": owner})

    def folder(self, owner, job_id):
        return media_folder(self.settings, owner, job_id)

    async def load(self, owner, job_id):
        async with self.session(owner) as session:
            return await session.get(VideoMediaJob, (owner, job_id))

    @staticmethod
    def receipt(job):
        return MediaJobOut(
            status=job.status,
            probe=job.probe,
            fingerprint=job.fingerprint,
            error=job.error,
            **job.outputs,
        )

    async def enqueue(self, owner, job_id, source):
        async with self.session(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VideoMediaJob, (owner, job_id))
            if row is None:
                row = VideoMediaJob(
                    owner_user_id=owner,
                    id=job_id,
                    project_id=source.project_id,
                    asset_id=source.asset_id,
                )
                session.add(row)
                await session.commit()
            elif (row.project_id, row.asset_id) != (source.project_id, source.asset_id):
                raise ValueError("剪辑任务请求范围冲突")
            return self.receipt(row)

    async def set_state(self, job, *, expected=None, **values):
        statement = update(VideoMediaJob).where(VideoMediaJob.id == job.id)
        if expected is not None:
            statement = statement.where(VideoMediaJob.status == expected)
        if values.get("status") == "completed":
            statement = statement.where(VideoMediaJob.cancel_requested.is_(False))
        async with self.session(job.owner_user_id) as session:
            changed = await session.execute(statement.values(**values))
            await session.commit()
            return changed.rowcount == 1

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            interrupted = (
                await session.scalars(
                    select(VideoMediaJob).where(VideoMediaJob.status == "running")
                )
            ).all()
        for job in interrupted:
            await self.set_state(job, expected="running", status="queued")

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            job = await session.scalar(
                select(VideoMediaJob)
                .where(VideoMediaJob.status == "queued")
                .order_by(VideoMediaJob.created_at, VideoMediaJob.id)
                .limit(1)
            )
        if job is not None:
            await self.execute(job)

    async def authorized(self, job):
        current_job = await self.load(job.owner_user_id, job.id)
        if current_job is None or current_job.cancel_requested:
            return False
        current = await self.identity.owner_permission(
            owner=job.owner_user_id, permission="content.write"
        )
        if not current["available"]:
            raise CapabilityUnavailable("剪辑处理授权暂不可用")
        return current["allowed"]

    async def execute(self, job):
        if not await self.set_state(job, expected="queued", status="running"):
            return
        root = self.folder(job.owner_user_id, job.id)
        target = root / "outputs"
        try:
            if not await self.authorized(job):
                await self.set_state(job, expected="running", status="cancelled")
                return
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            with TemporaryDirectory(dir=root, prefix="video-media-") as temporary:
                path = Path(temporary)
                source = path / "original"
                original = await download_original(
                    self.client,
                    self.originals,
                    owner=job.owner_user_id,
                    project=job.project_id,
                    asset=job.asset_id,
                    target=source,
                    max_bytes=self.settings.max_input_bytes,
                )
                probe = (
                    {"mediaKind": "font"}
                    if original.kind == "font"
                    else await run_sync(probe_media, source)
                )
                if not await self.set_state(job, expected="running", probe=probe):
                    return
                staged = path / "outputs"
                staged.mkdir(mode=0o700)
                probe, proxy, thumb, waveform, fingerprint = await run_sync(
                    prepare_media, source, job.asset_id, original.kind, staged, probe
                )
                if not await self.authorized(job):
                    await self.set_state(job, expected="running", status="cancelled")
                    return
                await run_sync(sync_files, staged)
                if target.exists():
                    await run_sync(rmtree, target)
                staged.rename(target)
                for parent in (root, root.parent, root.parent.parent):
                    await run_sync(sync_directory, parent)
                completed = await self.set_state(
                    job,
                    expected="running",
                    status="completed",
                    probe=probe,
                    fingerprint=fingerprint,
                    outputs={"proxy": proxy, "thumbnail": thumb, "waveform": waveform},
                )
                if not completed:
                    await self.set_state(job, expected="running", status="cancelled")
        except CapabilityUnavailable:
            await self.set_state(job, expected="running", status="queued")
            raise
        except Exception:
            await self.set_state(job, expected="running", status="failed", error="剪辑素材处理失败")

    async def purge(self, job):
        if job.status == "running":
            await self.set_state(job, expected="running", cancel_requested=True)
            return False
        if job.status == "queued" and not await self.set_state(
            job, expected="queued", status="cancelled"
        ):
            return False
        root = self.folder(job.owner_user_id, job.id)
        if root.exists():
            await run_sync(rmtree, root)
        return await self.set_state(job, status="cancelled", probe={}, fingerprint="", outputs={})
