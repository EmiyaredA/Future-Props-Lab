"""Cancel only a queued generation whose provider submission has not begun."""

from studio.runtime.database.task_records import transition_task
from studio.runtime.time import utc_now


async def cancel_queued(session, task, revision):
    now = utc_now()
    return await transition_task(
        session,
        type(task),
        task.id,
        revision,
        expected={"status": "queued", "provider_task_id": None},
        choices={"generation_kind": ("image", "video")},
        changes={"status": "cancelled", "updated_at": now, "completed_at": now},
    )
