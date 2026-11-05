"""Two isolated service databases and real Identity authorize redacted writing over HTTP."""

import asyncio
import os
import tempfile
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import select

from studio.apps.identity.accounts import create_account
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from studio.apps.model_service.admission.admission import ModelAdmission
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODEL_MIGRATIONS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.model_service.transport.provider_bindings import ProviderTransports
from studio.apps.model_service.writing import router
from studio.apps.thought_workshop.assistant import PreparedWriting
from studio.apps.thought_workshop.writing_models import HttpWritingModels
from studio.assembly.independent.identity.application import create_app
from studio.config.settings import get_settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.thought_workshop.writing import WritingInput
from studio.runtime.database.migrations import apply
from studio.runtime.database.ownership import bind_owner
from studio.runtime.database.sessions import Database
from studio.runtime.secrets import SecretCipher

root = Path(os.environ["THOUGHT_WRITING_ROOT"]).resolve()
assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
for service, migrations in (("identity", IDENTITY_MIGRATIONS), ("models", MODEL_MIGRATIONS)):
    apply(root / service / "service.db", service, migrations)
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
thought_credential, model_credential = "thought-writing-fixture-" * 3, "models-writing-fixture-" * 3
gateway, origin = "writing-gateway-fixture-" * 3, "http://127.0.0.1:19000"
password = "Synthetic-Writing-Password-2026!"
identity = create_app(
    state_root=root / "identity",
    catalog=catalog,
    gateway_token=gateway,
    local_origin=origin,
    public_origin="https://studio.example.test",
    private_key=key,
    service_credentials={"models": model_credential, "thought": thought_credential},
)


class Routing(httpx.AsyncBaseTransport):
    def __init__(self):
        self.targets = {}

    async def handle_async_request(self, request):
        return await self.targets[request.url.host].handle_async_request(request)


routes = Routing()
routes.targets["identity"] = httpx.ASGITransport(app=identity)
database = Database("models", root / "models", models=MODELS, account_models=ACCOUNT_MODELS)
models = FastAPI()
models.state.database = database
models.state.model_decrypt = SecretCipher(get_settings().fpl_secrets_key).decrypt
models.state.identity_public_key = key.public_key()
models.state.identity = LiveAuthorization(
    service="models",
    credential=model_credential,
    transport=routes,
)


async def reject_task_admission(*_args):
    raise AssertionError("A writing stream cannot enqueue persistent jobs")


models.state.model_admission = ModelAdmission(database.sessions).bindings(
    admit_tasks=reject_task_admission
)


def provider(request):
    assert request.url.host == "provider.example.test"
    assert "secret-note-content" in request.content.decode()
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        text=(
            'data: {"choices":[{"delta":{"content":"摘要"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],'
            '"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n'
            "data: [DONE]\n\n"
        ),
    )


models.state.model_provider_transports = ProviderTransports(
    resolve=lambda _url: httpx.MockTransport(provider)
)
models.include_router(router)
routes.targets["models"] = httpx.ASGITransport(app=models)
source_path = "/v1/thought-workshop/notes/note-alpha/assistant"


def unsafe(browser):
    return {"Origin": origin, "X-CSRF-Token": browser.cookies.get("fpl_csrf")}


async def assertion(browser, method="POST", path=source_path):
    response = await browser.get(
        "/_internal/v1/authorize",
        headers={
            **unsafe(browser),
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
        },
    )
    assert response.status_code == 204, response.text
    return response.headers["X-Fpl-Context"]


def backend(proof, *, method="POST", path=source_path, credential=thought_credential):
    return HttpWritingModels(
        assertion=proof,
        source_method=method,
        source_path=path,
        credential=credential,
        catalog=catalog,
        transport=routes,
    )


async def scenario():
    try:
        async with identity.router.lifespan_context(identity):
            async with identity.state.database.sessions() as session:
                for name in ("alpha", "beta"):
                    await create_account(
                        session,
                        username="writing-" + name,
                        display_name=name,
                        password=password,
                        platform_role="user",
                    )
            async with httpx.AsyncClient(
                transport=routes,
                base_url=origin,
                headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
            ) as a:
                # Identity's local origin is explicitly bound even through the synthetic transport.
                routes.targets["127.0.0.1"] = routes.targets["identity"]
                login = await a.post(
                    "/v1/auth/login", json={"username": "writing-alpha", "password": password}
                )
                assert login.status_code == 200, login.text
                owner = login.json()["user"]["id"]
                async with database.sessions(info={"owner_user_id": owner}) as session:
                    bind_owner(session, owner)
                    p = ModelProvider(
                        id="provider",
                        owner_user_id=owner,
                        name="fixture",
                        kind="openai",
                        base_url="https://provider.example.test/v1",
                        api_key_ciphertext="",
                        enabled=True,
                    )
                    session.add(p)
                    await session.flush()
                    session.add(
                        ModelEntry(
                            id="model-alpha",
                            owner_user_id=owner,
                            provider_id=p.id,
                            slug="fixture",
                            label="确定性模型",
                            capabilities=["chat"],
                            enabled=True,
                        )
                    )
                    await session.commit()
                proof = await assertion(a)
                writing = backend(proof)
                listed = await writing.list()
                assert [(item.id, item.label) for item in listed] == [("model-alpha", "确定性模型")]
                model = await writing.select("model-alpha")
                prepared = PreparedWriting(
                    owner,
                    "note-alpha",
                    7,
                    model,
                    "summary",
                    "secret-instruction",
                    "secret-note-content",
                )
                output = b"".join([part async for part in writing.events(prepared)]).decode()
                assert (
                    '"type": "delta"' in output
                    and "摘要" in output
                    and '"type": "complete"' in output
                ), output
                async with database.sessions(info={"owner_user_id": owner}) as session:
                    logs = list(await session.scalars(select(LlmCallLog)))
                    assert len(logs) == 1 and logs[0].total_tokens == 10
                    assert logs[0].request_payload == {
                        "note_id": "note-alpha",
                        "revision": 7,
                        "action": "summary",
                        "input_characters": 19,
                    }
                    assert "secret" not in str(logs[0].request_payload) + str(
                        logs[0].response_payload
                    )
                    leases = list(await session.scalars(select(RuntimeAdmission)))
                    assert len(leases) == 1 and leases[0].released_at is not None
                # A second normal account cannot select the first account's model.
                async with httpx.AsyncClient(
                    transport=routes,
                    base_url=origin,
                    headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
                ) as b:
                    assert (
                        await b.post(
                            "/v1/auth/login",
                            json={"username": "writing-beta", "password": password},
                        )
                    ).status_code == 200
                    assert await backend(await assertion(b)).list() == []
                # Other service credentials and unrelated source operations cannot grant writing.
                for bad in (
                    backend(proof, credential=model_credential),
                    backend(proof, path="/v1/thought-workshop/notes/note-alpha"),
                ):
                    try:
                        await bad.list()
                    except Exception as exc:
                        assert "fixture" not in str(exc)
                    else:
                        raise AssertionError("Unexpected writing delegation")
                body = WritingInput(
                    model_id=model.id,
                    note_id="note-alpha",
                    revision=7,
                    action="summary",
                    content="secret-note-content",
                )
                async with writing.client() as client:
                    token = await writing.authorize(client, "POST", body.path)
                    changed = {**body.model_dump(), "content": "changed"}
                    response = await client.post(
                        "http://models" + body.path, json=changed, headers={"X-Fpl-Context": token}
                    )
                    assert response.status_code == 422
                    assert (
                        await client.post(
                            "http://models" + body.path,
                            json=body.model_dump(),
                            headers={"X-Fpl-Context": token, "Origin": origin},
                        )
                    ).status_code == 403
                    assert (
                        await client.post("http://models" + body.path, json=body.model_dump())
                    ).status_code == 401
                assert (await a.post("/v1/auth/logout", headers=unsafe(a))).status_code == 204
                async with writing.client() as client:
                    denied = await client.post(
                        "http://models" + body.path,
                        json=body.model_dump(),
                        headers={"X-Fpl-Context": token},
                    )
                    assert denied.status_code == 401
                assert not models.openapi()["paths"]
                print("writing protocol, redaction, isolation, private scope and revocation passed")
    finally:
        await models.state.identity.close()
        await database.close()


asyncio.run(scenario())
