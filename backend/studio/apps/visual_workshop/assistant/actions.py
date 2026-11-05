from __future__ import annotations

from sqlalchemy import select, update

from studio.apps.visual_workshop.assistant_action_records import ACTIVE_ACTION_STATUSES
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
)
from studio.runtime.time import utc_now


async def recover_interrupted_visual_assistant_runs(*, sessions) -> None:
    async with sessions() as session:
        message_rows = list(
            (
                await session.execute(
                    select(VisualAssistantMessage).where(VisualAssistantMessage.status == "pending")
                )
            )
            .scalars()
            .all()
        )
        conversation_ids = {item.conversation_id for item in message_rows}
        for message in message_rows:
            message.status = "cancelled"
            message.error_message = "服务重启，本轮运行已取消"
            message.updated_at = utc_now()
        await session.execute(
            update(VisualAssistantAction)
            .where(VisualAssistantAction.status.in_(ACTIVE_ACTION_STATUSES))
            .values(
                status="cancelled",
                error_message="服务重启，本轮运行已取消",
                updated_at=utc_now(),
            )
        )
        if conversation_ids:
            await session.execute(
                update(VisualAssistantConversation)
                .where(VisualAssistantConversation.id.in_(conversation_ids))
                .values(
                    revision=VisualAssistantConversation.revision + 1,
                    updated_at=utc_now(),
                )
            )
        await session.commit()
