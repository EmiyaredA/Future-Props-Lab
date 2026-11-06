"""Compatibility website binding for Codex admission through its account service."""

from studio.assembly.website.code_agent_access import resolve
from studio.contracts.interview_assistant.documents import InterviewExecutorOut
from studio.host.agent_execution.cli.catalog import inspect_connection
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.ownership import bind_owner


async def executor_status(
    user_id: str, owner_user_id: str = "", session=None, *, sessions, settings
) -> InterviewExecutorOut:

    try:
        if session is None:
            async with sessions() as owned:
                if owner_user_id:
                    bind_owner(owned, owner_user_id)
                return await executor_status(
                    user_id, owner_user_id, owned, sessions=sessions, settings=settings
                )
        await resolve(
            session,
            owner_user_id,
            user_id,
            "codex",
            "interview_preparation",
            settings=settings,
            probe=False,
        )
        status = await inspect_connection(
            settings, "codex", discover_models=False, app_server=False
        )
        return InterviewExecutorOut(
            available=status["available"],
            code=status["status"],
            message=status["message"],
            version=status["version"],
        )
    except OperationError as exc:
        return InterviewExecutorOut(available=False, code=exc.code, message=str(exc), version="")
