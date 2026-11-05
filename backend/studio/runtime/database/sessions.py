"""Per-service sessions, scoped reads and rejected cross-service writes."""

from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, with_loader_criteria

from studio.contracts.gateway.catalog import service_by_id


class ServiceStorageError(RuntimeError):
    pass


class ServiceSession(Session):
    pass


@event.listens_for(ServiceSession, "do_orm_execute")
def scoped_operations(state):
    owned = set(state.session.info["owned_models"])
    models = state.session.info["account_models"]
    mapped = {mapper.class_ for mapper in state.all_mappers}
    if not mapped <= owned:
        raise ServiceStorageError("禁止访问其他服务的数据模型")
    owner = state.session.info.get("owner_user_id")
    if (
        mapped.intersection(models)
        and not owner
        and not (state.is_select and state.session.info.get("allow_system_reads") is True)
    ):
        raise ServiceStorageError("账号业务查询或写入缺少账号上下文")
    if state.is_insert and mapped.intersection(models):
        raise ServiceStorageError("账号记录必须通过受校验的 ORM 实例创建")
    if not owner:
        return
    statement = state.statement
    if state.is_select:
        for model in models:
            if hasattr(model, "owner_user_id"):
                statement = statement.options(
                    with_loader_criteria(
                        model, lambda cls: cls.owner_user_id == owner, include_aliases=True
                    )
                )
        state.statement = statement
    elif state.is_update or state.is_delete:
        mapper = state.bind_mapper
        if mapper is not None:
            if mapper.class_ not in state.session.info["owned_models"]:
                raise ServiceStorageError("禁止修改其他服务的数据表")
            if mapper.class_ in models and "owner_user_id" in mapper.local_table.c:
                state.statement = statement.where(mapper.local_table.c.owner_user_id == owner)


@event.listens_for(ServiceSession, "before_flush")
def validate_writes(session, _context, _instances):
    models = session.info["owned_models"]
    owner = session.info.get("owner_user_id")
    for row in set(session.new) | set(session.dirty) | set(session.deleted):
        if type(row) not in models:
            raise ServiceStorageError("禁止写入其他服务的数据模型")
        if type(row) not in session.info["account_models"] or not hasattr(
            type(row), "owner_user_id"
        ):
            continue
        if not owner:
            raise ServiceStorageError("账号业务写入缺少账号上下文")
        if row in session.new and getattr(row, "owner_user_id", None) is None:
            row.owner_user_id = owner
        if row.owner_user_id != owner:
            raise ServiceStorageError("禁止跨账号写入")


class Database:
    def __init__(
        self, service, state_root: Path, *, models=(), account_models=None, hide_parameters=False
    ):
        service_by_id(service)
        self.service = service
        self.root = state_root.resolve()
        self.path = self.root / "service.db"
        self.models = tuple(models)
        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{self.path.as_posix()}",
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
            hide_parameters=hide_parameters,
        )
        self.sessions = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            sync_session_class=ServiceSession,
            expire_on_commit=False,
            info={
                "service_id": service,
                "owned_models": self.models,
                "account_models": self.models if account_models is None else tuple(account_models),
            },
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def configure(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    async def close(self):
        await self.engine.dispose()
