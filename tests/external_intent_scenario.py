"""Real Identity verifies fixed Thought reads, terminal close and background step purposes."""

from uuid import uuid4

from studio.apps.integrations.clients.authority import IntegrationIntentClient
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.integrations.external_sync import (
    ExternalClose,
    ExternalIntentGrant,
    ExternalRead,
)
from studio.contracts.integrations.integration_intents import IntegrationScope


async def exercise_external_intents(browser, private, transport, unsafe, key, credentials, owner):
    async def authorize(method, path):
        result = await browser.get(
            "/_internal/v1/authorize",
            headers={
                **unsafe,
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": method,
                "X-Fpl-Request-Uri": path,
            },
        )
        assert result.status_code == 204, result.text
        return result.headers[HEADER]

    note, task = uuid4(), uuid4()
    connection = str(uuid4())
    source = f"/v1/thought-workshop/notes/{note}/external-sync/tasks"
    token = await authorize("POST", source)
    thought = IntegrationIntentClient(
        service="thought", credential=credentials["thought"], transport=transport
    )
    scope = IntegrationScope(
        kind="external.sync",
        task_id=task,
        source_resource_id=str(note),
        connection_id=connection,
        connection_revision=4,
        document_id="SyntheticDoc",
        input_sha256="b" * 64,
    )
    receipt = await thought.enroll(
        request_id=uuid4(), assertion=token, method="POST", path=source, scope=scope
    )
    assert (await thought.check(receipt.id)).actor.user_id == owner
    step = ExternalIntentGrant(
        intent_id=receipt.id, operation="step", step_id=uuid4(), request_sha256="c" * 64
    )
    granted = await thought.external_grant(step)
    actor = verify_context(
        granted, service="integrations", method="POST", path=step.path, public_key=key.public_key()
    )
    assert actor.user_id == owner
    denied = await private.post(
        "/_internal/v1/integration-intents/check",
        json={"service": "models", "intent_id": str(receipt.id)},
        headers={"Authorization": "Bearer " + credentials["models"]},
    )
    assert denied.status_code == 403, denied.text
    body = ExternalRead(op="read", connection_revision=4, document_id="SyntheticDoc")
    target = body.path(str(note), connection)
    delegation = {
        "caller": "thought",
        "purpose": "thought.external-sync.read",
        "source_method": "POST",
        "source_path": source,
        "target_service": "integrations",
        "target_method": "POST",
        "target_path": target,
        "assertion": token,
    }
    response = await private.post(
        "/_internal/v1/authorization/delegate",
        json=delegation,
        headers={"Authorization": "Bearer " + credentials["thought"]},
    )
    assert response.status_code == 200, response.text
    read_token = response.json()["assertion"]
    active = await private.post(
        "/_internal/v1/authorization/live",
        json={"service": "integrations", "assertion": read_token, "method": "POST", "path": target},
    )
    assert active.status_code == 200 and active.json() == {"active": True}, active.text
    mismatch = {**delegation, "target_path": body.path(str(uuid4()), connection)}
    denied = await private.post(
        "/_internal/v1/authorization/delegate",
        json=mismatch,
        headers={"Authorization": "Bearer " + credentials["thought"]},
    )
    assert denied.status_code == 403, denied.text
    # Close is a terminal acknowledgement from this exact article/task reconcile.
    close = ExternalClose(note_id=str(note), task_id=task)
    close_source = source + f"/{task}/reconcile"
    close_token = await authorize("POST", close_source)
    close_grant = {
        **delegation,
        "purpose": "thought.external-sync.close",
        "source_path": close_source,
        "target_path": close.path(),
        "assertion": close_token,
    }
    response = await private.post(
        "/_internal/v1/authorization/delegate",
        json=close_grant,
        headers={"Authorization": "Bearer " + credentials["thought"]},
    )
    assert response.status_code == 200, response.text
    denied = await private.post(
        "/_internal/v1/authorization/delegate",
        json={**close_grant, "source_path": source, "assertion": token},
        headers={"Authorization": "Bearer " + credentials["thought"]},
    )
    assert denied.status_code == 403, denied.text
    return thought, receipt, step, read_token, target
