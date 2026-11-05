"""Cancel interrupted playground messages before accepting new requests."""

from sqlalchemy import select, update

from studio.apps.model_service.storage.models.model_test import (
    ModelTestConversation,
    ModelTestMessage,
)
from studio.runtime.database.ownership import require_owner_id
from studio.runtime.time import utc_now


async def recover_interrupted_model_test_runs(session_factory) -> None:
    async with session_factory(info={"allow_system_reads": True}) as session:
        owners = list(
            await session.scalars(
                select(ModelTestConversation.owner_user_id)
                .join(
                    ModelTestMessage, ModelTestMessage.conversation_id == ModelTestConversation.id
                )
                .where(ModelTestMessage.status == "pending")
                .distinct()
                .order_by(ModelTestConversation.owner_user_id)
            )
        )
    for value in owners:
        owner = require_owner_id(value, subject="interrupted model conversation")
        async with session_factory(info={"owner_user_id": owner}) as session:
            messages = list(
                await session.scalars(
                    select(ModelTestMessage)
                    .join(
                        ModelTestConversation,
                        ModelTestMessage.conversation_id == ModelTestConversation.id,
                    )
                    .where(
                        ModelTestConversation.owner_user_id == owner,
                        ModelTestMessage.status == "pending",
                    )
                )
            )
            conversation_ids = {item.conversation_id for item in messages}
            for message in messages:
                message.status = "cancelled"
                message.error_message = "服务重启，本轮运行已取消"
                message.updated_at = utc_now()
            if conversation_ids:
                await session.execute(
                    update(ModelTestConversation)
                    .where(
                        ModelTestConversation.owner_user_id == owner,
                        ModelTestConversation.id.in_(conversation_ids),
                    )
                    .values(revision=ModelTestConversation.revision + 1, updated_at=utc_now())
                )
            await session.commit()
