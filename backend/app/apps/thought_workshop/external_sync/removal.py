"""Keep a recoverable article while an external write still needs user attention."""

from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError

from .models import ArticleSyncTask


async def ensure_can_purge(session, owner_user_id: str, note_id: str) -> None:
    active = await session.scalar(
        select(ArticleSyncTask.id).where(
            ArticleSyncTask.owner_user_id == owner_user_id,
            ArticleSyncTask.note_id == note_id,
            ArticleSyncTask.status.in_({"running", "needs_review"}),
        )
    )
    if active:
        raise ThoughtError(
            "外部同步尚未结束；请先恢复文档，在同步侧栏核对并结束任务后再永久删除",
            409,
            "external_sync_unresolved",
        )
