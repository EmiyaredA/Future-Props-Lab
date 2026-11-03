"""Creative-scoped writes protect public item ownership and private installations."""

from sqlalchemy import event, exists, inspect, select

from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from fpl_runtime.database import Database, ServiceSession, ServiceStorageError

from .models import ACCOUNT_MODELS, MODELS


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
    else:
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
                row.origin_owner_user_id != owner
                or (
                    row not in session.new and attributes.origin_owner_user_id.history.has_changes()
                )
                or (row not in session.new and attributes.author_user_id.history.has_changes())
                or (row in session.new and row.author_user_id != owner)
            ):
                raise ServiceStorageError("不能修改其他账号的创作归属")
            continue
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


def creative_database(state_root):
    database = Database("creative", state_root, models=MODELS, account_models=ACCOUNT_MODELS)
    database.sessions.configure(sync_session_class=CreativeSession)
    return database
