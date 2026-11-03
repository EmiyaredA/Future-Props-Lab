"""Independent Feishu steps bind actor, task payload, document and durable action receipts."""

import asyncio
import base64
import hashlib
import io
from uuid import uuid4

import httpx
from PIL import Image
from sqlalchemy import select

from app.integrations.external.blocks import feishu_tree
from fpl_integrations.records import ExternalExecution, ExternalStepReceipt
from fpl_runtime.external_sync import (
    ExternalAsset,
    ExternalClose,
    ExternalRead,
    ExternalStep,
    ExternalTaskPayload,
)
from fpl_runtime.integration_intents import IntegrationScope
from test_external_article_sync import FakeFeishu
from test_integrations_application import case as case


async def prepare(case, remote, *, image=False):
    case.app.state.external_reads.transport = remote.transport
    case.app.state.external_steps.transport = remote.transport
    connection = await case.call(
        "POST",
        "/v1/integrations/external-connections",
        json={"name": "owned-feishu", "app_id": "synthetic-app", "app_secret": "synthetic-secret"},
    )
    assert connection.status_code == 201, connection.text
    connection = connection.json()
    note_id = str(uuid4())
    read = ExternalRead(
        op="read", connection_revision=connection["revision"], document_id=remote.id
    )
    result = await case.call(
        "POST", read.path(note_id, connection["id"]), json=read.model_dump(mode="json")
    )
    assert result.status_code == 200, result.text
    content = {"nodes": [{"kind": "text", "runs": [{"text": "Owned article"}]}], "asset_ids": []}
    assets = []
    data = None
    if image:
        stream = io.BytesIO()
        Image.new("RGB", (1, 1), (10, 20, 30)).save(stream, format="PNG")
        data = stream.getvalue()
        asset_id = str(uuid4())
        content["nodes"].append({"kind": "image", "asset_id": asset_id})
        content["asset_ids"].append(asset_id)
        assets = [
            ExternalAsset(
                id=asset_id,
                filename="owned.png",
                mime="image/png",
                byte_size=len(data),
                content_sha=hashlib.sha256(data).hexdigest(),
            )
        ]
    payload = ExternalTaskPayload(content=content, remote=result.json(), asset_manifest=assets)
    intent, task_id = uuid4(), uuid4()
    scope = IntegrationScope(
        kind="external.sync",
        task_id=task_id,
        source_resource_id=note_id,
        connection_id=connection["id"],
        connection_revision=connection["revision"],
        document_id=remote.id,
        input_sha256=payload.fingerprint(),
    )
    case.port.scopes[str(intent)] = scope
    return intent, scope, payload, data


async def send(case, intent, body, *, owner="alpha"):
    return await case.call(
        "POST", body.path(intent), owner=owner, json=body.model_dump(mode="json")
    )


async def current(case, intent, scope):
    read = ExternalRead(
        op="read", connection_revision=scope.connection_revision, document_id=scope.document_id
    )
    response = await case.call("POST", read.task_path(intent), json=read.model_dump(mode="json"))
    assert response.status_code == 200, response.text
    return response.json()


async def test_independent_external_sync_all_steps_images_and_durable_idempotency(case):
    remote = FakeFeishu()
    intent, scope, payload, image = await prepare(case, remote, image=True)
    tree = feishu_tree(payload.content["nodes"])
    append = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="append",
        tree=tree,
        revision=payload.remote["revision"],
    )
    response = await send(case, intent, append)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert (await send(case, intent, append)).json() == response.json()
    assert remote.writes == ["append"]
    mapping = {
        row["temporary_block_id"]: row["block_id"] for row in response.json()["block_id_relations"]
    }
    block = mapping[next(iter(tree["images"]))]
    corrupt = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="upload_image",
        block_id=block,
        image_base64=base64.b64encode(b"wrong bytes").decode(),
    )
    assert (await send(case, intent, corrupt)).status_code == 409
    upload = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="upload_image",
        block_id=block,
        image_base64=base64.b64encode(image).decode(),
    )
    uploaded = await send(case, intent, upload)
    assert uploaded.status_code == 200, uploaded.text
    assert (await send(case, intent, upload)).json() == uploaded.json()
    before = await current(case, intent, scope)
    replace = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="replace_image",
        block_id=block,
        token=uploaded.json()["file_token"],
        revision=before["revision"],
    )
    response = await send(case, intent, replace)
    assert response.status_code == 200, response.text
    before = await current(case, intent, scope)
    delete = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="delete_prefix",
        count=len(payload.remote["root_ids"]),
        revision=before["revision"],
    )
    response = await send(case, intent, delete)
    assert response.status_code == 200, response.text
    assert (await send(case, intent, delete)).json() == response.json()
    assert remote.writes == ["append", "upload", "image", "delete"]
    assert "old" not in {block["block_id"] for block in remote.blocks}
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        task = await session.get(ExternalExecution, str(scope.task_id))
        steps = list(await session.scalars(select(ExternalStepReceipt)))
        assert task.status == "closed" and len(steps) == 4
        assert all(row.status == "confirmed" for row in steps)
    assert (await send(case, intent, delete, owner="beta")).status_code == 404


async def test_unknown_external_write_is_not_repeated_and_explicit_close_fences_late_steps(case):
    remote = FakeFeishu()
    intent, scope, payload, _ = await prepare(case, remote)
    remote.timeout_after_append = True
    body = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="append",
        tree=feishu_tree(payload.content["nodes"]),
        revision=payload.remote["revision"],
    )
    response = await send(case, intent, body)
    assert response.status_code == 502, response.text
    assert response.json()["code"] == "uncertain_write"
    await case.app.state.external_steps.recover()
    assert (await send(case, intent, body)).status_code == 409
    assert remote.writes == ["append"]
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ExternalStepReceipt, str(body.step_id))
        assert row.status == "unknown"
    wrong_note = ExternalClose(note_id=str(uuid4()), task_id=scope.task_id)
    rejected = await case.call("POST", wrong_note.path(), json=wrong_note.model_dump(mode="json"))
    assert rejected.status_code == 404, rejected.text
    close = ExternalClose(note_id=scope.source_resource_id, task_id=scope.task_id)
    for _ in range(2):
        response = await case.call("POST", close.path(), json=close.model_dump(mode="json"))
        assert response.status_code == 200, response.text
    assert (await send(case, intent, body)).status_code == 409
    assert remote.writes == ["append"]


async def test_silent_external_step_revocation_cancels_request_and_preserves_unknown(case):
    remote = FakeFeishu()
    intent, scope, payload, _ = await prepare(case, remote)
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def handle(request):
        if request.url.path.endswith("/descendant"):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        return remote.handle(request)

    case.app.state.external_steps.transport = httpx.MockTransport(handle)
    body = ExternalStep(
        task_payload=payload,
        step_id=uuid4(),
        kind="append",
        tree=feishu_tree(payload.content["nodes"]),
        revision=payload.remote["revision"],
    )
    pending = asyncio.create_task(send(case, intent, body))
    await asyncio.wait_for(entered.wait(), 2)
    case.port.active_value = False
    response = await asyncio.wait_for(pending, 4)
    assert response.status_code == 403, response.text
    assert cancelled.is_set()
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ExternalStepReceipt, str(body.step_id))
        assert row.status == "unknown"
