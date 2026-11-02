"""Cancel interrupted playground messages before accepting new requests."""

from sqlalchemy import select, update

from app.llm.models import ModelTestConversation, ModelTestMessage
from app.runtime.db import SessionLocal
from app.runtime.time import utc_now


async def recover_interrupted_model_test_runs() -> None:
    async with SessionLocal() as session:
        messages = list(
            (
                await session.execute(
                    select(ModelTestMessage).where(ModelTestMessage.status == "pending")
                )
            )
            .scalars()
            .all()
        )
        conversation_ids = {item.conversation_id for item in messages}
        for message in messages:
            message.status = "cancelled"
            message.error_message = "服务重启，本轮运行已取消"
            message.updated_at = utc_now()
        if conversation_ids:
            await session.execute(
                update(ModelTestConversation)
                .where(ModelTestConversation.id.in_(conversation_ids))
                .values(revision=ModelTestConversation.revision + 1, updated_at=utc_now())
            )
        await session.commit()
