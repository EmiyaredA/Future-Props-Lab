"""Restart recovery cancels interrupted replies across accounts exactly once."""

from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.migrations import apply_migrations
from studio.apps.model_service.playground import recovery
from studio.apps.model_service.storage.models.model_test import (
    ModelTestConversation,
    ModelTestMessage,
)


@pytest.mark.asyncio
async def test_restart_recovery_preserves_replies_and_unblocks_each_conversation(
    tmp_path: Path,
):
    database = tmp_path / "recovery.db"
    apply_migrations(database)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            for owner in ("first", "second"):
                session.add(ModelTestConversation(id=owner, owner_user_id=owner, revision=4))
                for position, status in enumerate(("completed", "pending", "pending")):
                    session.add(
                        ModelTestMessage(
                            id=f"{owner}-{position}",
                            conversation_id=owner,
                            turn_id=str(position),
                            position=position,
                            role="assistant",
                            content="partial reply",
                            status=status,
                        )
                    )
            session.add(ModelTestConversation(id="idle", owner_user_id="first", revision=9))
            await session.commit()
        await recovery.recover_interrupted_model_test_runs(sessions)
        await recovery.recover_interrupted_model_test_runs(sessions)
        async with sessions() as session:
            messages = (await session.scalars(select(ModelTestMessage))).all()
            for message in messages:
                assert message.content == "partial reply"
                if message.position == 0:
                    assert message.status == "completed"
                    assert message.error_message is None
                else:
                    assert message.status == "cancelled"
                    assert message.error_message == "服务重启，本轮运行已取消"
            conversations = (await session.scalars(select(ModelTestConversation))).all()
            assert {row.id: row.revision for row in conversations} == {
                "first": 5,
                "second": 5,
                "idle": 9,
            }
    finally:
        await engine.dispose()


async def test_recovery_uses_scoped_writes_in_an_independent_models_database(tmp_path):
    from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
    from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
    from studio.runtime.database.orm_base import Base
    from studio.runtime.database.sessions import Database

    owned = (ModelSupplier, ModelProvider, ModelEntry, ModelTestConversation, ModelTestMessage)
    database = Database("models", tmp_path, models=owned)
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(
                lambda c: Base.metadata.create_all(c, tables=[m.__table__ for m in owned])
            )
        for owner in ("alpha", "beta"):
            async with database.sessions(info={"owner_user_id": owner}) as session:
                session.add(ModelTestConversation(id=owner, owner_user_id=owner, revision=4))
                await session.flush()
                for position, status in enumerate(("completed", "pending")):
                    session.add(
                        ModelTestMessage(
                            id=f"{owner}-{position}",
                            conversation_id=owner,
                            turn_id=str(position),
                            position=position,
                            role="assistant",
                            content="preserved",
                            status=status,
                        )
                    )
                await session.commit()

        def interrupted_factory(**options):
            if options.get("info", {}).get("owner_user_id") == "beta":
                raise RuntimeError("synthetic restart between accounts")
            return database.sessions(**options)

        with pytest.raises(RuntimeError, match="synthetic restart"):
            await recovery.recover_interrupted_model_test_runs(interrupted_factory)
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            assert (await session.get(ModelTestConversation, "alpha")).revision == 5
        await recovery.recover_interrupted_model_test_runs(database.sessions)
        await recovery.recover_interrupted_model_test_runs(database.sessions)
        for owner in ("alpha", "beta"):
            async with database.sessions(info={"owner_user_id": owner}) as session:
                conversation = await session.get(ModelTestConversation, owner)
                assert conversation.revision == 5
                messages = list(
                    await session.scalars(
                        select(ModelTestMessage)
                        .where(ModelTestMessage.conversation_id == owner)
                        .order_by(ModelTestMessage.position)
                    )
                )
                assert [m.status for m in messages] == ["completed", "cancelled"]
                assert all(m.content == "preserved" for m in messages)
    finally:
        await database.close()
