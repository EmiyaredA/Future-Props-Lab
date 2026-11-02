"""Restart recovery cancels interrupted replies across accounts exactly once."""

from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.llm.models import ModelTestConversation, ModelTestMessage
from app.llm.playground import recovery
from db.migrations import apply_migrations


@pytest.mark.asyncio
async def test_restart_recovery_preserves_replies_and_unblocks_each_conversation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    database = tmp_path / "recovery.db"
    apply_migrations(database)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(recovery, "SessionLocal", sessions)
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
        await recovery.recover_interrupted_model_test_runs()
        await recovery.recover_interrupted_model_test_runs()
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
