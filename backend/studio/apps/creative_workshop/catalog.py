from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.creative_workshop.catalog_resources import CreativeResources
from studio.apps.creative_workshop.catalog_sources import MemoryIncoming
from studio.apps.creative_workshop.rules.publication import (
    KIND_VALUES,
    check_public_structure,
    public_manifest,
)
from studio.apps.creative_workshop.storage.catalog_files import (
    copy_skill_release,
    resolve_file,
    save_cover,
    save_skill_draft,
)
from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease
from studio.contracts.asset_library.incoming import IncomingFile
from studio.contracts.creative_workshop.catalog import (
    CreativeDraftIn,
    CreativeDraftUpdateIn,
    CreativeItemOut,
    CreativePageOut,
    CreativeReleaseOut,
)
from studio.contracts.creative_workshop.errors import CreativeError
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.files.image_sizes import ThumbnailSize
from studio.runtime.ids import new_id
from studio.runtime.time import iso_utc, utc_now


class CreativeCatalog:
    def __init__(
        self, session: AsyncSession, principal: StudioPrincipal, *, resources: CreativeResources
    ) -> None:
        self.session, self.principal = session, principal
        self.author_directory = resources.authors
        self.archive_parser = resources.archives
        self.source_reader = resources.sources
        self.file_settings = resources.settings

    def _can_write(self) -> None:
        if not self.principal.allows("content.write"):
            raise CreativeError("需要内容编辑权限", 403, "permission_denied")

    async def _owned(self, item_id: str) -> CreativeItem:
        item = await self.session.get(CreativeItem, item_id)
        if item is None or item.origin_owner_user_id != self.principal.owner_user_id:
            raise CreativeError("创作不存在", 404, "not_found")
        return item

    async def resolve_installable_release(
        self, release_id: str
    ) -> tuple[CreativeItem, CreativeRelease]:
        release = await self.session.get(CreativeRelease, release_id)
        item = await self.session.get(CreativeItem, release.item_id) if release else None
        if item is None or item.status != "published":
            raise CreativeError("公开能力版本不存在", 404, "not_found")
        return item, release

    async def _viewable_release(self, release_id: str) -> tuple[CreativeItem, CreativeRelease]:
        release = await self.session.get(CreativeRelease, release_id)
        item = await self.session.get(CreativeItem, release.item_id) if release else None
        if item is None:
            raise CreativeError("公开能力版本不存在", 404, "not_found")
        if item.status == "published":
            return item, release
        published_bundles = (
            await self.session.execute(
                select(CreativeRelease)
                .join(CreativeItem, CreativeItem.id == CreativeRelease.item_id)
                .where(
                    CreativeItem.kind == "bundle",
                    CreativeItem.status == "published",
                    CreativeItem.current_release_id == CreativeRelease.id,
                )
            )
        ).scalars()
        if any(release_id in bundle.components for bundle in published_bundles):
            return item, release
        raise CreativeError("公开能力版本不存在", 404, "not_found")

    async def _installable(self, release: CreativeRelease) -> bool:
        if not release.components:
            return True
        for release_id in release.components:
            try:
                item, _ = await self.resolve_installable_release(release_id)
            except CreativeError:
                return False
            if item.kind == "bundle":
                return False
        return True

    async def _out(self, item: CreativeItem, *, use_draft: bool = False) -> CreativeItemOut:
        release = (
            await self.session.get(CreativeRelease, item.current_release_id)
            if item.current_release_id
            else None
        )
        author_name = await self.author_directory.name(
            item_id=item.id, author_id=item.author_user_id
        )
        cover_path = item.draft_cover_path if use_draft else (release.cover_path if release else "")
        return CreativeItemOut(
            id=item.id,
            kind=item.kind,
            status=item.status,
            title=item.title if use_draft or release is None else release.title,
            summary=item.summary if use_draft or release is None else release.summary,
            description=item.description if use_draft or release is None else release.description,
            tags=list(item.tags if use_draft or release is None else release.tags),
            cover_preset=item.cover_preset
            if use_draft or release is None
            else release.cover_preset,
            cover_url=(
                f"/v1/creative-workshop/items/{item.id}/cover"
                + ("?draft=true" if use_draft else "")
                if cover_path
                else None
            ),
            manifest=dict(
                item.draft_manifest if use_draft or release is None else release.manifest
            ),
            components=list(
                item.draft_components if use_draft or release is None else release.components
            ),
            revision=item.revision,
            author_user_id=item.author_user_id,
            author_name=author_name or "已注销用户",
            origin_owner_user_id=item.origin_owner_user_id,
            current_release_id=item.current_release_id,
            version=release.version if release else None,
            installable=await self._installable(release) if release else False,
            created_at=iso_utc(item.created_at),
            updated_at=iso_utc(item.updated_at),
        )

    async def list(
        self, *, kind: str | None, query: str, mine: bool, cursor: int, limit: int
    ) -> CreativePageOut:
        if not self.principal.allows("content.read"):
            raise CreativeError("需要读取权限", 403, "permission_denied")
        statement = select(CreativeItem)
        if mine:
            statement = statement.where(
                CreativeItem.origin_owner_user_id == self.principal.owner_user_id,
            )
        else:
            statement = statement.where(CreativeItem.status == "published")
        if kind:
            if kind not in KIND_VALUES:
                raise CreativeError("内容类型无效")
            statement = statement.where(CreativeItem.kind == kind)
        if query.strip():
            pattern = f"%{query.strip()[:100]}%"
            statement = statement.where(
                or_(CreativeItem.title.ilike(pattern), CreativeItem.summary.ilike(pattern))
            )
        rows = (
            (
                await self.session.execute(
                    statement.order_by(CreativeItem.updated_at.desc(), CreativeItem.id)
                    .offset(cursor)
                    .limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        return CreativePageOut(
            items=[await self._out(row, use_draft=mine) for row in rows[:limit]],
            next_cursor=str(cursor + limit) if len(rows) > limit else None,
        )

    async def get(self, item_id: str, *, draft: bool = False) -> CreativeItemOut:
        if draft:
            return await self._out(await self._owned(item_id), use_draft=True)
        item = await self.session.scalar(
            select(CreativeItem)
            .where(CreativeItem.id == item_id, CreativeItem.status == "published")
            .execution_options(populate_existing=True)
        )
        if item is None:
            raise CreativeError("公开创作不存在", 404, "not_found")
        return await self._out(item)

    async def get_release(self, release_id: str) -> CreativeReleaseOut:
        item, release = await self._viewable_release(release_id)
        author_name = await self.author_directory.name(
            item_id=item.id, author_id=item.author_user_id
        )
        return CreativeReleaseOut(
            id=release.id,
            item_id=item.id,
            kind=item.kind,
            version=release.version,
            title=release.title,
            summary=release.summary,
            description=release.description,
            tags=release.tags,
            cover_preset=release.cover_preset,
            cover_url=f"/v1/creative-workshop/releases/{release.id}/cover"
            if release.cover_path
            else None,
            manifest=release.manifest,
            components=release.components,
            author_name=author_name or "已注销用户",
            installable=item.status == "published" and await self._installable(release),
            created_at=iso_utc(release.created_at),
        )

    async def cover_file(
        self, item_id: str, *, previews, draft: bool = False, size: ThumbnailSize | None = None
    ) -> Path:
        item = (
            await self._owned(item_id) if draft else await self.session.get(CreativeItem, item_id)
        )
        if item is None or (not draft and item.status != "published"):
            raise CreativeError("封面不存在", 404, "not_found")
        release = (
            await self.session.get(CreativeRelease, item.current_release_id) if not draft else None
        )
        relative = item.draft_cover_path if draft else (release.cover_path if release else "")
        if not relative:
            raise CreativeError("封面不存在", 404, "not_found")
        path = resolve_file(item.origin_owner_user_id, relative, settings=self.file_settings)
        if not path.is_file():
            raise CreativeError("封面文件不可用", 404, "not_found")
        if size is not None:
            await self.session.rollback()
            return await previews.render(path, path.with_name(f"{path.stem}-{size}.webp"), size)
        return path

    async def release_cover_file(
        self, release_id: str, size: ThumbnailSize | None = None, *, previews
    ) -> Path:
        item, release = await self._viewable_release(release_id)
        if not release.cover_path:
            raise CreativeError("封面不存在", 404, "not_found")
        path = resolve_file(
            item.origin_owner_user_id, release.cover_path, settings=self.file_settings
        )
        if not path.is_file():
            raise CreativeError("封面文件不可用", 404, "not_found")
        if size is not None:
            await self.session.rollback()
            return await previews.render(path, path.with_name(f"{path.stem}-{size}.webp"), size)
        return path

    async def upload_cover(
        self, item_id: str, expected_revision: int, upload: IncomingFile
    ) -> CreativeItemOut:
        self._can_write()
        item = await self._owned(item_id)
        if item.revision != expected_revision:
            raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
        owner = item.origin_owner_user_id
        await self.session.rollback()
        relative = await save_cover(owner, upload, settings=self.file_settings)
        commit_started = False
        try:
            result = await self.session.execute(
                update(CreativeItem)
                .where(
                    CreativeItem.id == item_id,
                    CreativeItem.origin_owner_user_id == owner,
                    CreativeItem.revision == expected_revision,
                )
                .values(
                    draft_cover_path=relative,
                    revision=CreativeItem.revision + 1,
                    updated_at=utc_now(),
                )
            )
            if result.rowcount != 1:
                raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
            commit_started = True
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            if not commit_started:
                resolve_file(owner, relative, settings=self.file_settings).unlink(missing_ok=True)
            raise
        return await self.get(item_id, draft=True)

    async def upload_skill(
        self, item_id: str, expected_revision: int, upload: IncomingFile
    ) -> CreativeItemOut:
        self._can_write()
        item = await self._owned(item_id)
        if item.kind != "skill":
            raise CreativeError("只有 Skill 创作可以上传 ZIP")
        if item.revision != expected_revision:
            raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
        owner = item.origin_owner_user_id
        await self.session.rollback()
        relative, manifest = await save_skill_draft(
            owner,
            item_id,
            upload,
            archive_parser=self.archive_parser,
            settings=self.file_settings,
        )
        commit_started = False
        try:
            result = await self.session.execute(
                update(CreativeItem)
                .where(
                    CreativeItem.id == item_id,
                    CreativeItem.origin_owner_user_id == owner,
                    CreativeItem.kind == "skill",
                    CreativeItem.revision == expected_revision,
                )
                .values(
                    draft_skill_path=relative,
                    draft_manifest=manifest,
                    revision=CreativeItem.revision + 1,
                    updated_at=utc_now(),
                )
            )
            if result.rowcount != 1:
                raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
            commit_started = True
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            if not commit_started:
                shutil.rmtree(
                    resolve_file(owner, relative, settings=self.file_settings), ignore_errors=True
                )
            raise
        return await self.get(item_id, draft=True)

    async def create(self, body: CreativeDraftIn) -> CreativeItemOut:
        self._can_write()
        item = CreativeItem(
            origin_owner_user_id=self.principal.owner_user_id,
            author_user_id=self.principal.user_id,
            kind=body.kind,
            title=body.title,
            summary=body.summary,
            description=body.description,
            tags=body.tags,
            cover_preset=body.cover_preset,
            draft_manifest=body.manifest,
            draft_components=body.components,
        )
        self.session.add(item)
        await self.session.commit()
        await self.session.refresh(item)
        return await self._out(item, use_draft=True)

    async def update(self, item_id: str, body: CreativeDraftUpdateIn) -> CreativeItemOut:
        self._can_write()
        item = await self._owned(item_id)
        if body.kind != item.kind:
            raise CreativeError("创作类型不能修改")
        result = await self.session.execute(
            update(CreativeItem)
            .where(CreativeItem.id == item_id, CreativeItem.revision == body.expected_revision)
            .values(
                title=body.title,
                summary=body.summary,
                description=body.description,
                tags=body.tags,
                cover_preset=body.cover_preset,
                draft_manifest=body.manifest,
                draft_components=body.components,
                revision=CreativeItem.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
        await self.session.commit()
        return await self.get(item_id, draft=True)

    async def publish(self, item_id: str, expected_revision: int) -> CreativeItemOut:
        self._can_write()
        item = await self._owned(item_id)
        if item.revision != expected_revision:
            raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
        if not item.title or not item.summary:
            raise CreativeError("发布前须填写名称和简介")
        check_public_structure([item.title, item.summary, item.description, item.tags])
        components: list[str] = []
        if item.kind == "bundle":
            components = list(item.draft_components or [])
            if not components:
                raise CreativeError("方案包至少包含一项公开能力")
            if len(components) > 30 or len(set(components)) != len(components):
                raise CreativeError("方案包能力列表无效")
            for release_id in components:
                component_item, _ = await self.resolve_installable_release(release_id)
                if component_item.kind == "bundle":
                    raise CreativeError("方案包不能嵌套方案包")
        else:
            if item.draft_components:
                raise CreativeError("独立能力不能包含其他能力")
        manifest = public_manifest(
            kind=item.kind,
            title=item.title,
            summary=item.summary,
            manifest=item.draft_manifest,
            has_skill=bool(item.draft_skill_path),
        )
        current_version = (
            await self.session.scalar(
                select(func.max(CreativeRelease.version)).where(CreativeRelease.item_id == item.id)
            )
        ) or 0
        release = CreativeRelease(
            id=new_id(),
            item_id=item.id,
            version=current_version + 1,
            title=item.title,
            summary=item.summary,
            description=item.description,
            tags=list(item.tags or []),
            cover_preset=item.cover_preset,
            cover_path=item.draft_cover_path,
            manifest=manifest,
            components=components,
        )
        skill_path = ""
        owner, kind, draft_skill = item.origin_owner_user_id, item.kind, item.draft_skill_path
        await self.session.rollback()
        commit_started = False
        try:
            if kind == "skill":
                skill_path = copy_skill_release(
                    owner, draft_skill, release.id, settings=self.file_settings
                )
                release.skill_path = skill_path
            result = await self.session.execute(
                update(CreativeItem)
                .where(
                    CreativeItem.id == item_id,
                    CreativeItem.origin_owner_user_id == owner,
                    CreativeItem.revision == expected_revision,
                )
                .values(
                    current_release_id=release.id,
                    status="published",
                    revision=CreativeItem.revision + 1,
                    updated_at=utc_now(),
                )
            )
            if result.rowcount != 1:
                raise CreativeError("草稿已在其他位置更新", 409, "revision_conflict")
            self.session.add(release)
            commit_started = True
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            if skill_path and not commit_started:
                shutil.rmtree(
                    resolve_file(owner, skill_path, settings=self.file_settings), ignore_errors=True
                )
            raise
        return await self.get(item_id)

    async def withdraw(self, item_id: str, expected_revision: int) -> CreativeItemOut:
        self._can_write()
        item = await self._owned(item_id)
        if item.status != "published":
            raise CreativeError("只有已发布的内容可以撤回")
        result = await self.session.execute(
            update(CreativeItem)
            .where(CreativeItem.id == item.id, CreativeItem.revision == expected_revision)
            .values(
                status="withdrawn",
                revision=CreativeItem.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise CreativeError("创作已在其他位置更新", 409, "revision_conflict")
        await self.session.commit()
        return await self.get(item_id, draft=True)

    async def import_source(
        self, kind: str, source_id: str, *, request_item_id: str | None = None
    ) -> CreativeItemOut:
        self._can_write()
        if not self.principal.allows("configuration.manage"):
            raise CreativeError("需要集成管理权限", 403, "permission_denied")
        if request_item_id and await self.session.get(CreativeItem, request_item_id) is not None:
            return await self.get(request_item_id, draft=True)
        if self.source_reader is None:
            raise CreativeError("创作来源服务尚未连接", 503, "creative_source_unavailable")
        try:
            snapshot = await self.source_reader.snapshot(
                owner=self.principal.owner_user_id, kind=kind, source_id=source_id
            )
        except ValueError as exc:
            raise CreativeError(str(exc)) from exc
        if snapshot is None or not snapshot.title:
            raise CreativeError("当前账号内找不到该集成", 404, "not_found")
        try:
            archive = snapshot.verified_skill()
        except ValueError as exc:
            raise CreativeError(str(exc)) from exc
        if archive is not None and (
            kind != "skill" or len(archive) > self.file_settings.fpl_skill_archive_max_bytes
        ):
            raise CreativeError("创作来源数据无效")
        item_id = request_item_id or new_id()
        owner = self.principal.owner_user_id
        await self.session.rollback()
        skill_path, manifest = "", dict(snapshot.manifest)
        if archive is not None:
            skill_path, manifest = await save_skill_draft(
                owner,
                item_id,
                MemoryIncoming(archive),
                archive_parser=self.archive_parser,
                settings=self.file_settings,
            )
        item = CreativeItem(
            id=item_id,
            origin_owner_user_id=owner,
            author_user_id=self.principal.user_id,
            kind=kind,
            title=snapshot.title,
            summary=snapshot.summary,
            draft_manifest=manifest,
            draft_skill_path=skill_path,
        )
        commit_started = False
        try:
            self.session.add(item)
            await self.session.flush()
            commit_started = True
            await self.session.commit()
        except BaseException as exc:
            await self.session.rollback()
            if skill_path and not commit_started:
                shutil.rmtree(
                    resolve_file(owner, skill_path, settings=self.file_settings), ignore_errors=True
                )
            if (
                isinstance(exc, IntegrityError)
                and request_item_id
                and await self.session.get(CreativeItem, request_item_id) is not None
            ):
                return await self.get(request_item_id, draft=True)
            raise
        await self.session.refresh(item)
        return await self._out(item, use_draft=True)
