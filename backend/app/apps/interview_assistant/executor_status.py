"""Compatibility website binding for Codex admission through its account service."""

from app.capabilities.agents.cli.catalog import inspect_connection
from app.console.governance.code_agents import resolve
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from app.runtime.operation_receipts import OperationError
from app.runtime.ownership import bind_owner

from .schemas import InterviewExecutorOut


async def executor_status(
    user_id: str, owner_user_id: str = "", session=None
) -> InterviewExecutorOut:

    try:
        if session is None:
            async with SessionLocal() as owned:
                if owner_user_id:
                    bind_owner(owned, owner_user_id)
                return await executor_status(user_id, owner_user_id, owned)
        await resolve(
            session, owner_user_id, user_id, "codex", "interview_preparation", probe=False
        )
        status = await inspect_connection(get_settings(), "codex", discover_models=False)
        return InterviewExecutorOut(
            available=status["available"],
            code=status["status"],
            message=status["message"],
            version=status["version"],
        )
    except OperationError as exc:
        return InterviewExecutorOut(available=False, code=exc.code, message=str(exc), version="")
