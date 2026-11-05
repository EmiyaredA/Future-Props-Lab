from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.common import (
    DuplicateIntegrationError,
    IntegrationNotFoundError,
    IntegrationValidationError,
)
from app.integrations.models import SkillIntegration, SkillVersion
from app.integrations.schemas import (
    SkillCatalogOut,
    SkillFileListOut,
    SkillFileTextOut,
    SkillMarkdownOut,
    SkillOut,
    SkillTagsIn,
    SkillUpdateIn,
    SkillVersionOut,
)
from app.integrations.skills.archive import (
    SKILL_MD_MAX_BYTES,
    SkillArchiveStorage,
    StagedSkillArchive,
)
from app.integrations.skills.preview import list_skill_files, read_skill_image, read_skill_text
from studio.config.settings import get_settings
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.database.ownership import require_owner_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


def _version_out(row: SkillVersion) -> SkillVersionOut:
    return SkillVersionOut(
        id=row.id,
        version=row.version,
        name=row.name,
        description=row.description,
        content_sha256=row.content_sha256,
        file_count=row.file_count,
        expanded_bytes=row.expanded_bytes,
        created_at=iso_utc(row.created_at),
    )


class SkillCatalog:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, storage=None) -> None:
        self.session = session
        self.owner_user_id = require_owner_id(owner_user_id, subject="Skill catalog")
        self.storage = storage or SkillArchiveStorage(get_settings(), self.owner_user_id)

    async def _get(self, skill_id: str) -> SkillIntegration:
        row = await self.session.get(SkillIntegration, skill_id)
        if row is None or row.owner_user_id != self.owner_user_id:
            raise IntegrationNotFoundError("Skill 不存在")
        return row

    async def _version_count(self, skill_id: str) -> int:
        return int(
            (
                await self.session.execute(
                    select(func.count(SkillVersion.id)).where(SkillVersion.skill_id == skill_id)
                )
            ).scalar_one()
        )

    async def _out(self, row: SkillIntegration) -> SkillOut:
        return SkillOut(
            id=row.id,
            name=row.name,
            description=row.description,
            default_version=row.default_version,
            latest_version=row.latest_version,
            version_count=await self._version_count(row.id),
            tags=row.tags,
            enabled=row.enabled,
            status=row.status,
            status_message=row.status_message,
            revision=row.revision,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def get(self, skill_id: str) -> SkillOut:
        return await self._out(await self._get(skill_id))

    async def catalog(self) -> SkillCatalogOut:
        rows = (
            (
                await self.session.execute(
                    select(SkillIntegration)
                    .where(SkillIntegration.owner_user_id == self.owner_user_id)
                    .order_by(SkillIntegration.updated_at.desc(), SkillIntegration.name)
                )
            )
            .scalars()
            .all()
        )
        skill_ids = [row.id for row in rows]
        total_versions = (
            int(
                (
                    await self.session.execute(
                        select(func.count(SkillVersion.id)).where(
                            SkillVersion.skill_id.in_(skill_ids)
                        )
                    )
                ).scalar_one()
            )
            if skill_ids
            else 0
        )
        return SkillCatalogOut(
            items=[await self._out(row) for row in rows],
            enabled_count=sum(row.enabled for row in rows),
            draft_count=sum(not row.enabled for row in rows),
            version_count=total_versions,
        )

    async def versions(self, skill_id: str) -> list[SkillVersionOut]:
        await self._get(skill_id)
        rows = (
            (
                await self.session.execute(
                    select(SkillVersion)
                    .where(SkillVersion.skill_id == skill_id)
                    .order_by(SkillVersion.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [_version_out(row) for row in rows]

    async def create(
        self, upload: IncomingFile, *, enabled: bool, tags: list[str] | None = None
    ) -> SkillOut:
        metadata = SkillTagsIn(tags=tags or [])
        staged = await self.storage.stage(upload)
        row = SkillIntegration(
            owner_user_id=self.owner_user_id,
            tags=metadata.tags,
            name=staged.name,
            description=staged.description,
            enabled=enabled,
            default_version="v1",
            latest_version="v1",
        )
        self.session.add(row)
        destination: Path | None = None
        committing = False
        try:
            await self.session.flush()
            destination = self.storage.place(staged, row.id, "v1")
            self.session.add(self._version_row(row.id, "v1", staged, destination))
            committing = True
            await self.session.commit()
        except BaseException as exc:
            await self.session.rollback()
            if not committing:
                if destination:
                    shutil.rmtree(destination.parent, ignore_errors=True)
                else:
                    shutil.rmtree(staged.directory, ignore_errors=True)
            if isinstance(exc, IntegrityError):
                raise DuplicateIntegrationError("Skill 名称已存在") from exc
            raise
        return await self.get(row.id)

    @staticmethod
    def _version_row(
        skill_id: str, version: str, staged: StagedSkillArchive, destination: Path
    ) -> SkillVersion:
        return SkillVersion(
            skill_id=skill_id,
            version=version,
            name=staged.name,
            description=staged.description,
            storage_path=str(destination),
            content_sha256=staged.sha256,
            file_count=staged.file_count,
            expanded_bytes=staged.expanded_bytes,
        )

    async def add_version(
        self, skill_id: str, upload: IncomingFile, *, expected_revision: int
    ) -> SkillOut:
        current = await self._get(skill_id)
        snapshot = await self._out(current)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, snapshot.model_dump(mode="json")
            )
        next_number = int(current.latest_version[1:]) + 1
        version = f"v{next_number}"
        current_name = current.name
        self.session.expunge(current)
        await self.session.rollback()
        staged = await self.storage.stage(upload)
        if staged.name != current_name:
            shutil.rmtree(staged.directory, ignore_errors=True)
            raise IntegrationValidationError("新版本 SKILL.md 的 name 必须与 Skill 一致")
        result = await self.session.execute(
            update(SkillIntegration)
            .where(
                SkillIntegration.id == skill_id,
                SkillIntegration.revision == expected_revision,
            )
            .values(
                name=staged.name,
                description=staged.description,
                latest_version=version,
                revision=SkillIntegration.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            shutil.rmtree(staged.directory, ignore_errors=True)
            await self.session.rollback()
            latest = await self._get(skill_id)
            latest_out = await self._out(latest)
            raise RevisionConflictError(
                expected_revision, latest.revision, latest_out.model_dump(mode="json")
            )
        destination: Path | None = None
        committing = False
        try:
            destination = self.storage.place(staged, skill_id, version)
            self.session.add(self._version_row(skill_id, version, staged, destination))
            committing = True
            await self.session.commit()
        except BaseException as exc:
            await self.session.rollback()
            if not committing:
                if destination:
                    shutil.rmtree(destination, ignore_errors=True)
                else:
                    shutil.rmtree(staged.directory, ignore_errors=True)
            if isinstance(exc, IntegrityError):
                raise DuplicateIntegrationError("Skill 版本已存在") from exc
            raise
        return await self.get(skill_id)

    async def update(self, skill_id: str, body: SkillUpdateIn) -> SkillOut:
        current = await self._get(skill_id)
        snapshot = await self._out(current)
        if current.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, current.revision, snapshot.model_dump(mode="json")
            )
        exists = await self.session.scalar(
            select(func.count(SkillVersion.id)).where(
                SkillVersion.skill_id == skill_id,
                SkillVersion.version == body.default_version,
            )
        )
        if not exists:
            raise IntegrationNotFoundError("Skill 版本不存在")
        result = await self.session.execute(
            update(SkillIntegration)
            .where(
                SkillIntegration.id == skill_id,
                SkillIntegration.revision == body.expected_revision,
            )
            .values(
                **({"tags": body.tags} if "tags" in body.model_fields_set else {}),
                enabled=body.enabled,
                default_version=body.default_version,
                revision=SkillIntegration.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(skill_id)
            latest_out = await self._out(latest)
            raise RevisionConflictError(
                body.expected_revision, latest.revision, latest_out.model_dump(mode="json")
            )
        await self.session.commit()
        return await self.get(skill_id)

    async def delete(self, skill_id: str, expected_revision: int) -> None:
        current = await self._get(skill_id)
        snapshot = await self._out(current)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, snapshot.model_dump(mode="json")
            )
        result = await self.session.execute(
            delete(SkillIntegration).where(
                SkillIntegration.id == skill_id,
                SkillIntegration.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(skill_id)
            latest_out = await self._out(latest)
            raise RevisionConflictError(
                expected_revision, latest.revision, latest_out.model_dump(mode="json")
            )
        # Never move or delete files before the database deletion is confirmed.
        # A lost commit reply leaves an orphan for owned startup reconciliation.
        await self.session.commit()
        self.storage.purge_delete(self.storage.stage_delete(skill_id))

    async def version_zip(self, skill_id: str, version: str) -> tuple[str, bytes]:
        root = await self._version_root(skill_id, version)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(root).as_posix())
        return f"skill-{skill_id}-{version}.zip", buffer.getvalue()

    async def version_markdown(self, skill_id: str, version: str) -> SkillMarkdownOut:
        root = await self._version_root(skill_id, version)
        try:
            path = next(
                (item for item in root.iterdir() if item.name.casefold() == "skill.md"), None
            )
            if path is None or path.is_symlink() or not path.is_file():
                raise IntegrationNotFoundError("SKILL.md 不存在")
            with path.open("rb") as source:
                data = source.read(SKILL_MD_MAX_BYTES + 1)
            if len(data) > SKILL_MD_MAX_BYTES:
                raise IntegrationValidationError("SKILL.md 超过 256 KiB 限制")
            return SkillMarkdownOut(version=version, content=data.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise IntegrationValidationError("SKILL.md 必须使用 UTF-8") from exc
        except OSError as exc:
            raise IntegrationNotFoundError("SKILL.md 不可读取") from exc

    async def version_files(self, skill_id: str, version: str) -> SkillFileListOut:
        return list_skill_files(await self._version_root(skill_id, version), version)

    async def version_file_text(self, skill_id: str, version: str, path: str) -> SkillFileTextOut:
        return read_skill_text(await self._version_root(skill_id, version), version, path)

    async def version_file_image(
        self, skill_id: str, version: str, path: str
    ) -> tuple[str, bytes, str]:
        root = await self._version_root(skill_id, version)
        return read_skill_image(root, path)

    async def _version_root(self, skill_id: str, version: str) -> Path:
        await self._get(skill_id)
        row = (
            await self.session.execute(
                select(SkillVersion).where(
                    SkillVersion.skill_id == skill_id,
                    SkillVersion.version == version,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise IntegrationNotFoundError("Skill 版本不存在")
        # Runtime roots can move with an offline desktop backup. Resolve from
        # the authorized owner/version instead of the legacy absolute DB path.
        root = self.storage.final_path(skill_id, version)
        if not root.is_relative_to(self.storage.root.resolve()) or not root.is_dir():
            raise IntegrationNotFoundError("Skill 版本内容不存在")
        return root
