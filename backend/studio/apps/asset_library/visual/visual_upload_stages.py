"""Journal private Visual media writes so only a committed Canvas publishes them."""

from shutil import rmtree
from uuid import uuid4

from sqlalchemy import select, text

from studio.apps.asset_library.archive_staging import SNAPSHOT_FIELDS
from studio.apps.asset_library.deletions import schedule
from studio.apps.asset_library.library_outputs import VerifiedOutput
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import ReferenceIntent, VisualUploadStage
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.media_rendering.local.gif_upload import prepare_output_upload
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.file_types import ALLOWED_FILES
from studio.contracts.thought_workshop.thought_assets import AssetDescription
from studio.contracts.visual_workshop.visual_upload import VisualUpload
from studio.runtime.ids import new_id

MATERIAL = {"image", "video", "audio"}


def conflict(code="visual_upload_conflict"):
    return AssetError("画布上传暂存状态冲突", code=code, status=409)


async def check_canvas_upload_fence(session, projection_id):
    pending = await session.scalar(
        select(VisualUploadStage.intent_id)
        .join(ReferenceIntent, ReferenceIntent.id == VisualUploadStage.intent_id)
        .where(
            ReferenceIntent.reference_set_id == projection_id,
            ReferenceIntent.state == "prepared",
        )
        .limit(1)
    )
    if pending is not None:
        raise conflict("visual_upload_pending")


def reserve(session, intent, project_id, descriptor, *, slots=2):
    session.add(
        VisualUploadStage(
            intent_id=intent.id,
            owner_user_id=intent.owner_user_id,
            project_id=project_id,
            descriptor=descriptor.model_dump(mode="json"),
            storage_keys=[uuid4().hex for _ in range(slots)],
        )
    )


def originals(stage):
    return [
        VisualAsset(
            id=record["id"],
            owner_user_id=stage.owner_user_id,
            project_id=stage.project_id,
            **record["asset"],
        )
        for record in stage.originals
    ]


async def publish(session, intent):
    stage = await session.get(VisualUploadStage, intent.id)
    if stage is None:
        return set()
    if stage.state != "sealed":
        raise conflict("visual_upload_unsealed")
    files = originals(stage)
    session.add_all(files)
    stage.state = "published"
    await session.flush()
    return {item.id for item in files}


async def abort(session, intent):
    stage = await session.get(VisualUploadStage, intent.id)
    if stage is None:
        return
    if stage.state == "sealed":
        schedule(session, originals(stage))
        stage.state = "aborted"
    elif stage.state == "writing":
        # The writer has exclusive use of these paths until it exits. Startup
        # recovery finishes this cleanup if the worker process also stops.
        stage.state = "canceling"
    elif stage.state == "reserved":
        stage.state = "aborted"


def _remove_unpublished(storage, stage):
    for key in stage.storage_keys:
        path = storage.target_path(
            key,
            visual_project_id=stage.project_id,
            galgame_project_id=None,
            owner_user_id=stage.owner_user_id,
        )
        path.unlink(missing_ok=True)
        scratch = path.parent / ".tmp"
        if scratch.is_dir() and not scratch.is_symlink():
            for item in scratch.glob(f"{key}-*.tmp"):
                item.unlink(missing_ok=True)


async def _discard(session, storage, identity):
    await session.execute(text("BEGIN IMMEDIATE"))
    stage = await session.get(VisualUploadStage, identity, populate_existing=True)
    if stage is not None and stage.state in {"writing", "canceling"}:
        _remove_unpublished(storage, stage)
        stage.state = "aborted"
    await session.commit()


def transcode_work_root(settings):
    root = settings.runtime_path / ".visual-upload-work"
    if root.is_symlink():
        raise ValueError("Visual 上传转换暂存目录不能是符号链接")
    root.mkdir(mode=0o700, exist_ok=True)
    return root


async def recover(database, settings):
    storage = AssetStorage(settings)
    # The Assets process holds the state lock during startup. Scratch from a
    # previous process is disposable and never contains published originals.
    for entry in transcode_work_root(settings).glob("visual-gif-upload-*"):
        if entry.is_symlink():
            entry.unlink()
        elif entry.is_dir():
            rmtree(entry)
    async with database.sessions(info={"allow_system_reads": True}) as session:
        pending = list(
            await session.execute(
                select(VisualUploadStage.owner_user_id, VisualUploadStage.intent_id).where(
                    VisualUploadStage.state.in_(("writing", "canceling"))
                )
            )
        )
    for owner, identity in pending:
        async with database.sessions(info={"owner_user_id": owner}) as session:
            await _discard(session, storage, identity)


class VisualUploadFiles:
    def __init__(self, session, settings, owner, intent_id):
        self.session, self.settings, self.owner, self.intent_id = (
            session,
            settings,
            owner,
            intent_id,
        )

    async def _stage(self):
        stage = await self.session.get(VisualUploadStage, self.intent_id, populate_existing=True)
        if stage is None or stage.owner_user_id != self.owner:
            raise AssetError("上传准备不存在", code="not_found", status=404)
        return stage

    @staticmethod
    def _receipt(stage):
        if stage.state not in {"sealed", "published"}:
            raise conflict("visual_upload_unsealed")
        return {"items": [record["result"] for record in stage.originals]}

    async def receipt(self):
        return self._receipt(await self._stage())

    async def _begin(self, length):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        stage = await self._stage()
        try:
            descriptor = VisualUpload.model_validate(stage.descriptor)
        except ValueError:
            raise AssetError("上传准备不存在", code="not_found", status=404) from None
        maximum = self.settings.fpl_visual_asset_max_bytes
        if descriptor.byte_size > maximum:
            raise AssetError("文件超过上传大小限制", code="file_too_large", status=413)
        if length != descriptor.byte_size:
            raise AssetError("上传文件长度不符", code="visual_upload_changed", status=422)
        if stage.state != "reserved":
            return self._receipt(stage), None, (), None
        stage.state = "writing"
        keys, project = tuple(stage.storage_keys), stage.project_id
        await self.session.commit()
        return None, descriptor, keys, project

    async def receive(self, incoming, length, require_active):
        await require_active()
        prior, descriptor, keys, project = await self._begin(length)
        if prior is not None:
            return prior
        maximum = self.settings.fpl_visual_asset_max_bytes
        allowed = MATERIAL if descriptor.kind == "material" else {descriptor.kind}
        extensions = {suffix for suffix, (kind, _) in ALLOWED_FILES.items() if kind in allowed}
        checked = VerifiedOutput(
            incoming,
            descriptor,
            changed=AssetError("上传文件摘要或长度不符", code="visual_upload_changed", status=422),
        )
        storage = AssetStorage(self.settings)
        try:
            records = []
            async with prepare_output_upload(
                checked,
                descriptor.kind,
                max_bytes=maximum,
                work_root=transcode_work_root(self.settings),
            ) as (
                source,
                inspection,
            ):
                for index, part in enumerate(item for item in (source, inspection) if item):
                    row = await AssetLibrary(self.session, self.settings).store_upload(
                        part,
                        owner_user_id=self.owner,
                        visual_project_id=project,
                        allowed_extensions=extensions if index == 0 else {".webm"},
                        max_bytes=maximum,
                        defer_persistence=True,
                        reserved_storage_key=keys[index],
                    )
                    records.append(staged_record(row))
            await require_active(sealed=True)
            await self.session.execute(text("BEGIN IMMEDIATE"))
            stage = await self._stage()
            if stage.state != "writing":
                raise conflict("visual_upload_aborted")
            stage.originals, stage.state = records, "sealed"
            result = self._receipt(stage)
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            await _discard(self.session, storage, self.intent_id)
            raise


def staged_record(row):
    row.id, row.revision = new_id(), 0
    return {
        "id": row.id,
        "asset": {name: getattr(row, name) for name in SNAPSHOT_FIELDS},
        "result": {
            **AssetDescription.model_validate(row, from_attributes=True).model_dump(),
            "display_name": row.display_name,
        },
    }
