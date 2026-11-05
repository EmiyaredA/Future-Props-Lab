"""Published Skill pin and file operations on an Amadeus-owned conversation."""

import asyncio
from functools import partial

from anyio.to_thread import run_sync
from fastapi import APIRouter, Request

from app.console.amadeus.conversations import Conversations
from app.console.amadeus.skill_files import read_skill_file, skill_root
from fpl_runtime.http_dependencies import SessionDep, StudioAuth

from .skill_pins import SkillSource, load_pin

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.post("/conversations/{conversation_id}/skills/{skill_id}/load")
async def skill_load(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    skill_id: str,
) -> dict[str, str]:
    state = request.app.state
    async with state.file_locks.setdefault((principal.user_id, conversation_id), asyncio.Lock()):
        await Conversations(session, principal)._get(conversation_id)
        await session.rollback()
        root = skill_root(
            principal.user_id, conversation_id, skill_id, files_root=state.database.root
        )
        return await load_pin(
            root,
            SkillSource(
                state.capabilities, request.state.service_assertion, request.url.path, skill_id
            ),
        )


@router.get(
    "/conversations/{conversation_id}/skills/{skill_id}/{version}/files/{relative_path:path}"
)
async def skill_file_read(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    skill_id: str,
    version: str,
    relative_path: str,
) -> dict[str, str | int]:
    await Conversations(session, principal)._get(conversation_id)
    await session.rollback()
    return await run_sync(
        partial(
            read_skill_file,
            principal.user_id,
            conversation_id,
            skill_id,
            version,
            relative_path,
            files_root=request.app.state.database.root,
        )
    )
