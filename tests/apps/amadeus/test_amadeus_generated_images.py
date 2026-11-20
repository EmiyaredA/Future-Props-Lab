"""Originals, receipts, history and cancellation live in the Amadeus account boundary."""

import hashlib
import io
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image

from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.files import list_files, read_file_bytes, write_file
from studio.apps.amadeus.storage.generated_images import GeneratedImages, image_metadata
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.recovery import recover_runs
from studio.apps.amadeus.storage.runs import RunRecords
from studio.apps.amadeus.storage.service_models import MODELS
from studio.contracts.amadeus.conversations import RunCreateIn, RunEventIn
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.migrations import apply
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.sessions import Database


def png(color="red"):
    stream = io.BytesIO()
    Image.new("RGBA", (4, 3), color).save(stream, format="PNG")
    return stream.getvalue()


async def authorized():
    pass


@pytest.fixture
async def owned(tmp_path):
    apply(tmp_path / "service.db", "amadeus", MIGRATIONS)
    database = Database("amadeus", tmp_path, models=MODELS, hide_parameters=True)
    principal = StudioPrincipal(
        user_id=str(uuid4()),
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )

    async def resolve(_agent):
        return "fixture-connection"

    async def start(**options):
        async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
            conversation = await Conversations(session, principal).create()
            run = await RunRecords(session, principal, resolve_agent=resolve).create(
                conversation.id, RunCreateIn(agent_id="codex", **options)
            )
        return conversation.id, run.run.id

    yield SimpleNamespace(database=database, principal=principal, root=tmp_path, start=start)
    await database.close()


async def test_image_original_receipt_and_image_only_history_survive_restart(owned):
    conversation, run = await owned.start()
    images = GeneratedImages(
        owned.database.sessions, owned.principal, conversation, run, owned.root
    )
    data = png()
    saved = await images.save("item", data, authorize=authorized)
    assert await images.save("item", data, authorize=authorized) == saved
    assert saved["sha256"] == hashlib.sha256(data).hexdigest()
    with pytest.raises(OperationError, match="只读"):
        write_file(
            owned.principal.user_id,
            conversation,
            "outputs",
            saved["name"],
            b"replacement",
            saved["sha256"],
            files_root=owned.root,
        )
    assert (
        read_file_bytes(
            owned.principal.user_id, conversation, "outputs", saved["name"], files_root=owned.root
        )
        == data
    )
    assert len(list_files(owned.principal.user_id, conversation, files_root=owned.root)) == 1
    async with owned.database.sessions(info={"owner_user_id": owned.principal.user_id}) as session:
        await recover_runs(session)
        result = await RunRecords(session, owned.principal).detail(conversation, run)
        history = await Conversations(session, owned.principal).detail(conversation)
    assert result.run.status == "interrupted"
    assert result.run.generated_images[0].name == saved["name"]
    assert len(result.events) == 1
    assert result.events[0].payload["status"] == "completed"
    assert "result" not in result.events[0].payload
    assert history.messages[-1].content == ""
    assert history.messages[-1].references[0].source == "outputs"


@pytest.mark.parametrize("options", [{"codex_image_generation": False}, {"mode": "plan"}])
async def test_disabled_image_generation_cannot_write(owned, options):
    conversation, run = await owned.start(**options)
    images = GeneratedImages(
        owned.database.sessions, owned.principal, conversation, run, owned.root
    )
    with pytest.raises(OperationError, match="未启用"):
        await images.save("item", png(), authorize=authorized)
    assert list_files(owned.principal.user_id, conversation, files_root=owned.root) == []


async def test_duplicate_identity_cannot_overwrite_and_forged_completion_is_rejected(owned):
    conversation, run = await owned.start()
    images = GeneratedImages(
        owned.database.sessions, owned.principal, conversation, run, owned.root
    )
    await images.save("item", png(), authorize=authorized)
    with pytest.raises(OperationError, match="回执"):
        await images.save("item", png("blue"), authorize=authorized)
    async with owned.database.sessions(info={"owner_user_id": owned.principal.user_id}) as session:
        record = await RunRecords(session, owned.principal).detail(conversation, run)
        with pytest.raises(OperationError, match="原件"):
            await RunRecords(session, owned.principal).append_event(
                conversation,
                run,
                RunEventIn(
                    kind="image_generation",
                    payload=record.events[0].payload,
                    idempotency_key="forged",
                ),
            )
    other = replace(owned.principal, user_id=str(uuid4()), platform_role="admin")
    images = GeneratedImages(owned.database.sessions, other, conversation, run, owned.root)
    with pytest.raises(OperationError, match="不存在"):
        await images.save("other", png(), authorize=authorized)


async def test_cancel_or_revocation_does_not_publish_a_missing_original(owned):
    conversation, run = await owned.start()
    images = GeneratedImages(
        owned.database.sessions, owned.principal, conversation, run, owned.root
    )
    async with owned.database.sessions(info={"owner_user_id": owned.principal.user_id}) as session:
        await RunRecords(session, owned.principal).mark_cancelling(conversation, run)
    with pytest.raises(OperationError, match="未启用"):
        await images.save("item", png(), authorize=authorized)
    assert list_files(owned.principal.user_id, conversation, files_root=owned.root) == []


@pytest.mark.parametrize("data", [b"", b"not-a-png", png()[:40]])
def test_invalid_or_truncated_images_are_rejected(data):
    with pytest.raises(OperationError):
        image_metadata(data)


def test_image_byte_and_decode_limits_are_checked_before_publication(monkeypatch):
    from studio.apps.amadeus.storage import generated_images

    data = png()
    monkeypatch.setattr(generated_images, "MAX_GENERATED_IMAGE_BYTES", len(data) - 1)
    with pytest.raises(OperationError, match="50 MiB"):
        image_metadata(data)
    monkeypatch.setattr(generated_images, "MAX_GENERATED_IMAGE_BYTES", len(data))
    monkeypatch.setattr(generated_images, "MAX_GENERATED_IMAGE_PIXELS", 11)
    with pytest.raises(OperationError, match="尺寸"):
        image_metadata(data)
