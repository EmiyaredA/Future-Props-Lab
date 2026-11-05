"""Creative-scoped writes protect public item ownership and private installations."""

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import event, exists, inspect, select

from app.console.creative_workshop.files import resolve_file
from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from app.integrations.skills.archive import SkillArchiveStager
from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence
from studio.apps.creative_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.runtime.database.sessions import Database, ServiceSession, ServiceStorageError


class CreativeSession(ServiceSession):
    """Public reads remain available; writes are bound to the originating account."""


@event.listens_for(CreativeSession, "do_orm_execute")
def scope_public_writes(state):
    if not (state.is_insert or state.is_update or state.is_delete) or state.bind_mapper is None:
        return
    model = state.bind_mapper.class_
    if model not in (CreativeItem, CreativeRelease):
        return
    if state.is_insert:
        raise ServiceStorageError("创作记录必须通过受校验的 ORM 实例创建")
    owner = state.session.info.get("owner_user_id")
    if not owner:
        raise ServiceStorageError("创作写入缺少账号上下文")
    if state.is_update:
        # SQLAlchemy exposes update assignments on its statement; prevent a bulk
        # update from moving a root or release after the owner predicate matches.
        values = getattr(state.statement, "_values", None) or {}
        parameters = state.parameters or {}
        parameter_sets = parameters if isinstance(parameters, list) else [parameters]
        fields = {getattr(key, "key", key) for key in values}
        fields.update(key for entry in parameter_sets for key in entry)
        protected = (
            {"origin_owner_user_id", "author_user_id"} if model is CreativeItem else {"item_id"}
        )
        if fields.intersection(protected):
            raise ServiceStorageError("不能修改创作或版本的归属")
    if model is CreativeItem:
        state.statement = state.statement.where(CreativeItem.origin_owner_user_id == owner)
        if state.is_delete or (
            state.is_update and fields.intersection({"status", "current_release_id", "kind"})
        ):
            state.statement = state.statement.where(
                ~exists(
                    select(CreativeInstallFence.item_id).where(
                        CreativeInstallFence.item_id == CreativeItem.id
                    )
                )
            )
    else:
        state.statement = state.statement.where(
            ~exists(
                select(CreativeInstallFence.item_id).where(
                    CreativeInstallFence.item_id == CreativeRelease.item_id
                )
            )
        )
        state.statement = state.statement.where(
            exists(
                select(CreativeItem.id).where(
                    CreativeItem.id == CreativeRelease.item_id,
                    CreativeItem.origin_owner_user_id == owner,
                )
            )
        )


@event.listens_for(CreativeSession, "before_flush")
def protect_public_roots(session, _context, _instances):
    pending = set(session.new) | set(session.dirty) | set(session.deleted)
    for row in pending:
        if not isinstance(row, (CreativeItem, CreativeRelease)):
            continue
        owner = session.info.get("owner_user_id")
        if not owner:
            raise ServiceStorageError("创作写入缺少账号上下文")
        if isinstance(row, CreativeItem):
            attributes = inspect(row).attrs
            if (
                row not in session.new
                and (
                    row in session.deleted
                    or attributes.status.history.has_changes()
                    or attributes.current_release_id.history.has_changes()
                    or attributes.kind.history.has_changes()
                )
                and session.connection()
                .execute(
                    select(CreativeInstallFence.item_id).where(
                        CreativeInstallFence.item_id == row.id
                    )
                )
                .first()
                is not None
            ):
                raise ServiceStorageError("安装结果未确认，暂不能修改发布状态")
            if (
                row.origin_owner_user_id != owner
                or (
                    row not in session.new and attributes.origin_owner_user_id.history.has_changes()
                )
                or (row not in session.new and attributes.author_user_id.history.has_changes())
                or (row in session.new and row.author_user_id != owner)
            ):
                raise ServiceStorageError("不能修改其他账号的创作归属")
            continue
        if (
            row not in session.new
            and session.connection()
            .execute(
                select(CreativeInstallFence.item_id).where(
                    CreativeInstallFence.item_id == row.item_id
                )
            )
            .first()
            is not None
        ):
            raise ServiceStorageError("安装结果未确认，暂不能修改公开版本")
        pending_parent = next(
            (
                item
                for item in session.new
                if isinstance(item, CreativeItem) and item.id == row.item_id
            ),
            None,
        )
        if pending_parent is not None:
            valid = pending_parent.origin_owner_user_id == owner
        else:
            valid = (
                session.connection()
                .execute(
                    select(CreativeItem.id).where(
                        CreativeItem.id == row.item_id, CreativeItem.origin_owner_user_id == owner
                    )
                )
                .first()
                is not None
            )
        if not valid or (
            row not in session.new and inspect(row).attrs.item_id.history.has_changes()
        ):
            raise ServiceStorageError("不能修改其他账号的公开版本")


SKILL_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024
SKILL_EXPANDED_MAX_BYTES = 50 * 1024 * 1024
SKILL_MAX_FILES = 500


@dataclass(frozen=True)
class CreativeStorageSettings:
    runtime_path: Path
    fpl_skill_archive_max_bytes: int
    fpl_skill_expanded_max_bytes: int
    fpl_skill_max_files: int


@dataclass(frozen=True)
class CreativeArchiveStaging:
    settings: CreativeStorageSettings

    async def stage(self, owner, upload):
        root = resolve_file(owner, "creative-workshop/.staging", settings=self.settings)
        return await SkillArchiveStager(root, self.settings).stage(upload)


def creative_database(
    state_root,
    *,
    skill_archive_max_bytes=SKILL_ARCHIVE_MAX_BYTES,
    skill_expanded_max_bytes=SKILL_EXPANDED_MAX_BYTES,
    skill_max_files=SKILL_MAX_FILES,
):
    limits = (skill_archive_max_bytes, skill_expanded_max_bytes, skill_max_files)
    if any(type(limit) is not int or limit < 1 for limit in limits):
        raise ValueError("Skill 归档大小限制无效")
    database = Database("creative", state_root, models=MODELS, account_models=ACCOUNT_MODELS)
    settings = CreativeStorageSettings(database.root, *limits)
    database.sessions.configure(
        sync_session_class=CreativeSession,
        info={
            **database.sessions.kw["info"],
            "creative_file_settings": settings,
            "creative_archives": CreativeArchiveStaging(settings),
        },
    )
    return database
