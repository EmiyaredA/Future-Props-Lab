from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.desktop_pet.models import DesktopPetProject
from app.apps.desktop_pet.schemas import (
    PetConfig,
    PetCreate,
    PetDocumentOut,
    PetPatch,
    PetPersona,
    PetProjectOut,
    PetProjectsOut,
    PetReaction,
    PetSave,
    PetSync,
)
from app.apps.desktop_pet.whale_package import MAX_ARCHIVE, read_whale_package
from app.apps.live2d_workshop.public import (
    CharacterSnapshot,
    decode_character_png,
    snapshot_character,
)
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
    importing_project_layout,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.live2d.document import CharacterDocument
from app.runtime.config import get_settings
from app.runtime.ids import new_id
from app.runtime.project_records import (
    delete_revisioned_project,
    load_owned_project,
    patch_revisioned_project,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now

APP = "desktop-pet"
MAX_SNAPSHOT = 512 * 1024 * 1024
MAX_SKIN_PNG = 16 * 1024 * 1024
WHALE_MOTIONS = frozenset(
    (
        "stand",
        "jump",
        "hop",
        "look",
        "turn",
        "nod",
        "shake",
        "spin",
        "sit",
        "sleep",
        "dizzy",
        "walk",
        "run",
    )
)
WHALE_EXPRESSIONS = frozenset(
    ("neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad", "sleepy", "thinking")
)


class PetNotFound(Exception):
    pass


class PetInvalid(ValueError):
    pass


def _used_assets(character: CharacterDocument) -> set[str]:
    return {part.asset_id for part in character.parts}


def _image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def _write_package_images(images: dict[Path, bytes]) -> None:
    for path, content in images.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as image:
            image.write(content)


def _remove_package_images(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


class DesktopPetProjects:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(get_settings())

    def root(self, project_id: str) -> Path:
        return self.storage.project_root(APP, project_id, owner_user_id=self.owner_user_id)

    def source_root(self, project_id: str, revision: int) -> Path:
        return self.root(project_id) / "assets" / "source" / str(revision)

    def skin_path(self, project_id: str, asset_id: str) -> Path:
        return self.root(project_id) / "assets" / "skins" / f"{asset_id}.png"

    def whale_path(self, project_id: str, asset_id: str) -> Path:
        return self.root(project_id) / "assets" / "whale" / f"{asset_id}.png"

    async def row(self, project_id: str) -> DesktopPetProject:
        return await load_owned_project(
            self.session,
            DesktopPetProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: PetNotFound("桌宠项目不存在"),
        )

    @staticmethod
    def out(row: DesktopPetProject) -> PetProjectOut:
        scheme = PetConfig.model_validate(row.config).scheme_id or "deepseek"
        thumbnail_id = (row.whale_assets or {}).get(f"thumbs/{scheme}.png")
        return PetProjectOut(
            id=row.id,
            title=row.title,
            revision=row.revision,
            sourceType=row.source_type,
            sourceProjectId=row.source_project_id,
            sourceRevision=row.source_revision,
            sourceTitle=row.source_title,
            thumbnailUrl=(
                f"/v1/{APP}/projects/{row.id}/assets/{thumbnail_id}/file"
                if row.source_type == "coopanion-whale" and thumbnail_id
                else None
            ),
            createdAt=iso_utc(row.created_at),
            updatedAt=iso_utc(row.updated_at),
        )

    async def list(self) -> PetProjectsOut:
        rows = (
            await self.session.scalars(
                select(DesktopPetProject)
                .where(DesktopPetProject.owner_user_id == self.owner_user_id)
                .order_by(DesktopPetProject.updated_at.desc())
            )
        ).all()
        return PetProjectsOut(items=[self.out(row) for row in rows])

    async def get(self, project_id: str) -> PetProjectOut:
        return self.out(await self.row(project_id))

    async def document(self, project_id: str) -> PetDocumentOut:
        row = await self.row(project_id)
        config = PetConfig.model_validate(row.config)
        if row.source_type == "coopanion-whale":
            assets = row.whale_assets or {}
            urls = {
                asset_id: f"/v1/{APP}/projects/{project_id}/assets/{asset_id}/file"
                for asset_id in assets.values()
            }
            return PetDocumentOut(
                revision=row.revision,
                sourceType="coopanion-whale",
                sourceRevision=None,
                character=None,
                whaleModel=row.whale_model,
                whaleAssets=assets,
                config=config,
                assetUrls=urls,
            )
        character = CharacterDocument.model_validate(row.character)
        base = _used_assets(character)
        replacements = {
            asset_id for skin in config.skins for asset_id in skin.replacements.values()
        }
        urls = {
            asset_id: f"/v1/{APP}/projects/{project_id}/assets/{asset_id}/file"
            for asset_id in base | replacements
        }
        return PetDocumentOut(
            revision=row.revision,
            sourceType="live2d",
            sourceRevision=row.source_revision,
            character=character,
            whaleModel=None,
            whaleAssets=None,
            config=config,
            assetUrls=urls,
        )

    async def _copy_source(self, snapshot: CharacterSnapshot, project_id: str) -> Path:
        target = self.source_root(project_id, snapshot.revision)
        total = sum(path.stat().st_size for path in snapshot.assets.values())
        if total > MAX_SNAPSHOT:
            raise PetInvalid("角色素材总大小超过 512 MiB")
        target.mkdir(parents=True, exist_ok=False)
        try:
            for asset_id, path in snapshot.assets.items():
                await asyncio.to_thread(shutil.copyfile, path, target / f"{asset_id}.png")
        except BaseException:
            await asyncio.to_thread(shutil.rmtree, target, True)
            raise
        return target

    async def create(self, body: PetCreate) -> PetProjectOut:
        snapshot = await snapshot_character(
            self.session,
            self.owner_user_id,
            body.source_project_id,
            expected_revision=body.source_revision,
        )
        title = body.title.strip() or f"{snapshot.title} · 桌宠"
        row = DesktopPetProject(
            id=new_id(),
            owner_user_id=self.owner_user_id,
            source_type="live2d",
            source_project_id=snapshot.project_id,
            source_revision=snapshot.revision,
            source_title=snapshot.title,
            title=title,
            character=snapshot.document.model_dump(mode="json", by_alias=True),
            config=PetConfig().model_dump(mode="json", by_alias=True),
        )
        async with creating_project_layout(
            self.session, self.storage, APP, row.id, owner_user_id=self.owner_user_id
        ):
            await self._copy_source(snapshot, row.id)
            self.session.add(row)
        await self.session.refresh(row)
        return self.out(row)

    async def import_whale(self, incoming: IncomingFile) -> PetProjectOut:
        data = await incoming.read(MAX_ARCHIVE + 1)
        package = await asyncio.to_thread(read_whale_package, data)
        assets = {name: new_id() for name in package.images}
        human = package.model.get("rigProfile") == "human-chibi"
        name = (package.model.get("character") or {}).get("name", "DeepSeek 大肥鱼").strip()
        persona = PetPersona.model_validate(
            (package.model.get("character") or {}).get("persona", {})
        )
        config = PetConfig(schemeId=package.model["schemes"][0]["id"], persona=persona)
        if human:
            config.events = {
                "click": PetReaction(motionId="hop", expressionId="surprised"),
                "pet": PetReaction(motionId="nod", expressionId="shy"),
                "grab": PetReaction(motionId="look", expressionId="angry"),
                "drop": PetReaction(motionId="stand", expressionId="happy"),
                "roam": PetReaction(motionId="walk"),
            }
        row = DesktopPetProject(
            id=new_id(),
            owner_user_id=self.owner_user_id,
            source_type="coopanion-whale",
            source_project_id=None,
            source_revision=None,
            source_title=name if human else f"Coopanion · {name}",
            title=name,
            character=None,
            whale_model=package.model,
            whale_assets=assets,
            config=config.model_dump(mode="json", by_alias=True),
        )
        async with importing_project_layout(
            self.session, self.storage, APP, row.id, owner_user_id=self.owner_user_id
        ):
            for name, content in package.images.items():
                path = self.whale_path(row.id, assets[name])
                path.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(path.write_bytes, content)
            self.session.add(row)
        await self.session.refresh(row)
        return self.out(row)

    async def replace_package(
        self, project_id: str, expected_revision: int, incoming: IncomingFile
    ) -> PetDocumentOut:
        row = await self.row(project_id)
        if row.source_type != "coopanion-whale":
            raise PetInvalid("仅本地分层角色支持更新资源包")
        if row.revision != expected_revision:
            current = await self.document(project_id)
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        profile = row.whale_model.get("rigProfile", "whale")
        config = PetConfig.model_validate(row.config)
        old_paths = [self.whale_path(project_id, asset) for asset in row.whale_assets.values()]
        # Close the read transaction before archive decoding and filesystem I/O.
        await self.session.rollback()
        data = await incoming.read(MAX_ARCHIVE + 1)
        package = await asyncio.to_thread(read_whale_package, data)
        if package.model.get("rigProfile", "whale") != profile:
            raise PetInvalid("更新资源包必须使用相同骨架类型")
        schemes = {scheme["id"] for scheme in package.model["schemes"]}
        if config.scheme_id not in schemes:
            raise PetInvalid("更新资源包必须保留当前默认服饰")
        if any(
            (event.motion_id and event.motion_id not in WHALE_MOTIONS)
            or (event.expression_id and event.expression_id not in WHALE_EXPRESSIONS)
            for event in config.events.values()
        ):
            raise PetInvalid("当前交互配置与新资源包不兼容")
        assets = {name: new_id() for name in package.images}
        images = {
            self.whale_path(project_id, assets[name]): content
            for name, content in package.images.items()
        }
        writer = asyncio.create_task(asyncio.to_thread(_write_package_images, images))
        try:
            try:
                await asyncio.shield(writer)
            except asyncio.CancelledError:
                # A worker must finish before compensation can remove its files.
                await writer
                raise
            await patch_revisioned_project(
                self.session,
                DesktopPetProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                values={
                    "whale_model": package.model,
                    "whale_assets": assets,
                    "revision": expected_revision + 1,
                    "updated_at": utc_now(),
                },
                load_current=lambda: self.document(project_id),
            )
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            await asyncio.to_thread(_remove_package_images, list(images))
            raise
        # The switch is committed. Failure to prune obsolete files must not turn
        # a successful update into a client retry that replaces the package again.
        try:
            await asyncio.to_thread(_remove_package_images, old_paths)
        except OSError:
            pass
        return await self.document(project_id)

    async def patch(self, project_id: str, body: PetPatch) -> PetProjectOut:
        await self.row(project_id)
        title = body.title.strip()
        if not title:
            raise PetInvalid("项目名称不能为空")
        await patch_revisioned_project(
            self.session,
            DesktopPetProject,
            project_id,
            self.owner_user_id,
            expected_revision=body.expected_revision,
            values={
                "title": title,
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    def validate_config(
        self,
        project_id: str,
        character: CharacterDocument,
        config: PetConfig,
        source_assets: dict[str, Path],
    ) -> None:
        motions = {motion.id for motion in character.motions}
        expressions = {expression.id for expression in character.expressions}
        base = _used_assets(character)
        for event in config.events.values():
            if event.motion_id and event.motion_id not in motions:
                raise PetInvalid("交互引用了不存在的动作")
            if event.expression_id and event.expression_id not in expressions:
                raise PetInvalid("交互引用了不存在的表情")
        for skin in config.skins:
            for source_id, replacement_id in skin.replacements.items():
                if (
                    source_id not in base
                    or not self.skin_path(project_id, replacement_id).is_file()
                ):
                    raise PetInvalid("皮肤引用了缺失素材或其他项目的素材")
                source_path = source_assets[source_id]
                if _image_size(source_path) != _image_size(
                    self.skin_path(project_id, replacement_id)
                ):
                    raise PetInvalid("替换贴图必须与原部件尺寸一致")

    async def save(self, project_id: str, body: PetSave) -> PetDocumentOut:
        row = await self.row(project_id)
        old = PetConfig.model_validate(row.config)
        if row.source_type == "coopanion-whale":
            schemes = {item["id"] for item in row.whale_model["schemes"]}
            if (
                body.config.scheme_id not in schemes
                or body.config.skins
                or body.config.active_skin_id
            ):
                raise PetInvalid("鲸鱼娘配色或皮肤配置无效")
            for event in body.config.events.values():
                if event.motion_id and event.motion_id not in WHALE_MOTIONS:
                    raise PetInvalid("交互引用了不存在的鲸鱼娘动作")
                if event.expression_id and event.expression_id not in WHALE_EXPRESSIONS:
                    raise PetInvalid("交互引用了不存在的鲸鱼娘表情")
        else:
            if body.config.scheme_id is not None:
                raise PetInvalid("Live2D 桌宠不支持鲸鱼娘配色")
            character = CharacterDocument.model_validate(row.character)
            source_assets = {
                asset_id: self.source_root(project_id, row.source_revision) / f"{asset_id}.png"
                for asset_id in _used_assets(character)
            }
            self.validate_config(project_id, character, body.config, source_assets)
        await patch_revisioned_project(
            self.session,
            DesktopPetProject,
            project_id,
            self.owner_user_id,
            expected_revision=body.expected_revision,
            values={
                "config": body.config.model_dump(mode="json", by_alias=True),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.document(project_id),
        )
        await self.session.commit()
        old_ids = {asset for skin in old.skins for asset in skin.replacements.values()}
        new_ids = {asset for skin in body.config.skins for asset in skin.replacements.values()}
        for asset_id in old_ids - new_ids:
            self.skin_path(project_id, asset_id).unlink(missing_ok=True)
        return await self.document(project_id)

    async def upload_skin(
        self,
        project_id: str,
        skin_id: str,
        source_asset_id: str,
        expected_revision: int,
        incoming: IncomingFile,
    ) -> PetDocumentOut:
        row = await self.row(project_id)
        if row.source_type != "live2d":
            raise PetInvalid("鲸鱼娘只支持原版配色")
        character = CharacterDocument.model_validate(row.character)
        if source_asset_id not in _used_assets(character):
            raise PetInvalid("角色部件素材不存在")
        config = PetConfig.model_validate(row.config)
        skin = next((item for item in config.skins if item.id == skin_id), None)
        if skin is None:
            raise PetInvalid("皮肤不存在，请先保存皮肤")
        if row.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision,
                row.revision,
                (await self.document(project_id)).model_dump(mode="json"),
            )
        data = await incoming.read(MAX_SKIN_PNG + 1)
        if len(data) > MAX_SKIN_PNG:
            raise PetInvalid("皮肤贴图超过 16 MiB")
        image, width, height = await asyncio.to_thread(decode_character_png, data)
        base_path = self.source_root(project_id, row.source_revision) / f"{source_asset_id}.png"
        if not base_path.is_file() or (width, height) != await asyncio.to_thread(
            _image_size, base_path
        ):
            raise PetInvalid("替换贴图必须与原部件尺寸一致")
        asset_id = new_id()
        path = self.skin_path(project_id, asset_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, image)
        old_asset_id = skin.replacements.get(source_asset_id)
        skin.replacements[source_asset_id] = asset_id
        try:
            await patch_revisioned_project(
                self.session,
                DesktopPetProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                values={
                    "config": config.model_dump(mode="json", by_alias=True),
                    "revision": expected_revision + 1,
                    "updated_at": utc_now(),
                },
                load_current=lambda: self.document(project_id),
            )
            await self.session.commit()
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        if old_asset_id and not any(
            old_asset_id in item.replacements.values() for item in config.skins
        ):
            self.skin_path(project_id, old_asset_id).unlink(missing_ok=True)
        return await self.document(project_id)

    async def sync_source(self, project_id: str, body: PetSync) -> PetDocumentOut:
        row = await self.row(project_id)
        if row.source_type != "live2d":
            raise PetInvalid("导入的鲸鱼娘是固定快照")
        if row.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                row.revision,
                (await self.document(project_id)).model_dump(mode="json"),
            )
        snapshot = await snapshot_character(
            self.session,
            self.owner_user_id,
            row.source_project_id,
            expected_revision=body.source_revision,
        )
        if snapshot.revision == row.source_revision:
            return await self.document(project_id)
        config = PetConfig.model_validate(row.config)
        self.validate_config(project_id, snapshot.document, config, snapshot.assets)
        replacement_sources = {asset_id for skin in config.skins for asset_id in skin.replacements}
        old_root = self.source_root(project_id, row.source_revision)
        for asset_id in replacement_sources:
            old_path = old_root / f"{asset_id}.png"
            new_path = snapshot.assets[asset_id]
            if await asyncio.to_thread(_image_size, old_path) != await asyncio.to_thread(
                _image_size, new_path
            ):
                raise PetInvalid("来源贴图尺寸变化，现有皮肤无法自动沿用")
        target = await self._copy_source(snapshot, project_id)
        try:
            await patch_revisioned_project(
                self.session,
                DesktopPetProject,
                project_id,
                self.owner_user_id,
                expected_revision=body.expected_revision,
                values={
                    "source_revision": snapshot.revision,
                    "source_title": snapshot.title,
                    "character": snapshot.document.model_dump(mode="json", by_alias=True),
                    "revision": body.expected_revision + 1,
                    "updated_at": utc_now(),
                },
                load_current=lambda: self.document(project_id),
            )
            await self.session.commit()
        except BaseException:
            await asyncio.to_thread(shutil.rmtree, target, True)
            raise
        await asyncio.to_thread(shutil.rmtree, old_root, True)
        return await self.document(project_id)

    async def asset_path(self, project_id: str, asset_id: str) -> Path:
        row = await self.row(project_id)
        if row.source_type == "coopanion-whale":
            if asset_id not in (row.whale_assets or {}).values():
                raise PetNotFound("桌宠素材不存在")
            path = self.whale_path(project_id, asset_id)
            if not path.is_file():
                raise PetNotFound("桌宠素材不存在")
            return path
        character = CharacterDocument.model_validate(row.character)
        if asset_id in _used_assets(character):
            path = self.source_root(project_id, row.source_revision) / f"{asset_id}.png"
        else:
            config = PetConfig.model_validate(row.config)
            replacements = {
                replacement for skin in config.skins for replacement in skin.replacements.values()
            }
            if asset_id not in replacements:
                raise PetNotFound("桌宠素材不存在")
            path = self.skin_path(project_id, asset_id)
        if not path.is_file():
            raise PetNotFound("桌宠素材不存在")
        return path

    async def delete(self, project_id: str, expected_revision: int) -> None:
        await self.row(project_id)
        async with deleting_project_layout(
            self.session, self.storage, APP, project_id, owner_user_id=self.owner_user_id
        ):
            await delete_revisioned_project(
                self.session,
                DesktopPetProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
