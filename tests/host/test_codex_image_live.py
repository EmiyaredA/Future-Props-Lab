"""Explicit opt-in: one real image, isolated Amadeus state, existing dedicated CLI login."""

import asyncio
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest

from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.files import read_file_bytes
from studio.apps.amadeus.storage.generated_images import GeneratedImages
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.runs import RunRecords
from studio.apps.amadeus.storage.service_models import MODELS
from studio.contracts.amadeus.conversations import RunCreateIn, RunEventIn
from studio.contracts.identity.principal import StudioPrincipal
from studio.host.agent_execution.cli.conversation import codex
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


@pytest.mark.skipif(os.environ.get("FPL_CODEX_IMAGE_LIVE") != "1", reason="explicit live opt-in")
async def test_one_real_codex_image_can_be_saved_and_reopened(tmp_path):
    executable = os.environ["FPL_CODEX_IMAGE_LIVE_EXECUTABLE"]
    profile = Path(os.environ["FPL_CODEX_IMAGE_LIVE_PROFILE"])
    apply(tmp_path / "service.db", "amadeus", MIGRATIONS)
    database = Database("amadeus", tmp_path, models=MODELS, hide_parameters=True)
    actor = StudioPrincipal(
        user_id=str(uuid4()),
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )

    async def resolve(_agent):
        return executable

    async def authorize():
        pass

    try:
        async with database.sessions(info={"owner_user_id": actor.user_id}) as session:
            conversation = await Conversations(session, actor).create()
            run = await RunRecords(session, actor, resolve_agent=resolve).create(
                conversation.id, RunCreateIn(agent_id="codex")
            )
        images = GeneratedImages(database.sessions, actor, conversation.id, run.run.id, tmp_path)

        async def emit(kind, payload):
            async with database.sessions(info={"owner_user_id": actor.user_id}) as session:
                await RunRecords(session, actor).append_event(
                    conversation.id,
                    run.run.id,
                    RunEventIn(kind=kind, payload=payload, idempotency_key=str(uuid4())),
                )

        async def save(identity, data):
            return await images.save(identity, data, authorize=authorize)

        async def no_task_tools(*_args):
            raise AssertionError("live smoke needs only native image generation")

        async with asyncio.timeout(420):
            await codex(
                executable,
                profile,
                "",
                "Use your built-in image_gen tool exactly once to generate one small flat "
                "illustration of an orange cube on a pale cream background. This is an "
                "image-generation integration test, not a coding task. Do not use shell "
                "or any other tools. After generation say done.",
                [],
                no_task_tools,
                emit,
                save_image=save,
            )
        async with database.sessions(info={"owner_user_id": actor.user_id}) as session:
            result = await RunRecords(session, actor).finish(
                conversation.id, run.run.id, "completed", None
            )
        assert len(result.run.generated_images) == 1
        image = result.run.generated_images[0]
        data = read_file_bytes(
            actor.user_id, conversation.id, "outputs", image.name, files_root=tmp_path
        )
        assert hashlib.sha256(data).hexdigest() == image.sha256
        async with database.sessions(info={"owner_user_id": actor.user_id}) as session:
            reopened = await Conversations(session, actor).detail(conversation.id)
        assert reopened.messages[-1].references[0].name == image.name
        (tmp_path / "result.json").write_text(
            json.dumps(
                {
                    "image": image.model_dump(mode="json"),
                    "path": str(
                        tmp_path
                        / "accounts"
                        / actor.user_id
                        / "amadeus"
                        / conversation.id
                        / "outputs"
                        / image.name
                    ),
                    "reopened": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        await database.close()
