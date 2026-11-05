"""Actual Identity delegation, Assets bytes and Models writes use three isolated databases."""

import asyncio
import io
import os
import sys
import tempfile
import wave
from contextlib import AsyncExitStack
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Request
from sqlalchemy import select

from app.llm.http_errors import mapped
from app.llm.inference.assets import InferenceAssets
from app.llm.library_inputs import LibraryInputBindings, library_inputs
from app.llm.models import ModelInferenceAsset
from app.llm.schemas.model_inference import InferenceAssetImportIn, InferenceAssetOut
from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from studio.apps.identity.accounts import create_account
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from studio.apps.model_service.library_inputs import HttpLibraryInputs
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.independent.asset_library.application import create_app as create_assets
from studio.assembly.independent.identity.application import create_app as create_identity
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient

root = Path(os.environ["MODEL_LIBRARY_INPUT_ROOT"]).resolve()
assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
for service, migrations in (
    ("identity", IDENTITY_MIGRATIONS),
    ("assets", ASSET_MIGRATIONS),
    ("models", MODELS_MIGRATIONS),
):
    apply(root / service / "service.db", service, migrations)
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
model_credential, asset_credential = "model-library-fixture-" * 3, "asset-library-fixture-" * 3
gateway = "gateway-library-fixture-" * 3
origin = "http://127.0.0.1:19000"
source_path = "/v1/model-inference/assets/import"
password = "Synthetic-Library-Password-2026!"
identity = create_identity(
    state_root=root / "identity",
    catalog=catalog,
    gateway_token=gateway,
    local_origin=origin,
    public_origin="https://studio.example.test",
    private_key=key,
    service_credentials={"models": model_credential, "assets": asset_credential},
)


class Routing(httpx.AsyncBaseTransport):
    def __init__(self):
        self.targets = {}

    async def handle_async_request(self, request):
        return await self.targets[request.url.host].handle_async_request(request)


class Projects:
    async def project_exists(self, **body):
        return body["project_id"] == "fixture-project"

    async def close(self):
        pass


routes = Routing()
routes.targets["identity"] = httpx.ASGITransport(app=identity)
assets = create_assets(
    settings=StorageSettings(root / "assets/service.db"),
    catalog=catalog,
    public_key=key.public_key(),
    identity=LiveAuthorization(
        service="assets",
        credential=asset_credential,
        transport=routes,
    ),
    capabilities=Projects(),
    cleanup=False,
)
routes.targets["assets"] = httpx.ASGITransport(app=assets)
capabilities = CapabilityClient(
    service="models", credential=model_credential, catalog=catalog, transport=routes
)
models = Database("models", root / "models", models=MODELS, account_models=ACCOUNT_MODELS)
model_settings = SimpleNamespace(
    runtime_path=root / "models", fpl_visual_asset_max_bytes=1024 * 1024
)
model_app = FastAPI()
model_app.state.database = models
model_app.state.model_library_inputs = LibraryInputBindings(
    for_request=lambda request, _session, _owner: HttpLibraryInputs(
        capabilities,
        assertion=request.state.service_assertion,
        method=request.method,
        path=request.url.path,
        max_bytes=model_settings.fpl_visual_asset_max_bytes,
    )
)
model_app.add_middleware(
    SignedIdentity, service="models", public_key=key.public_key(), catalog=catalog
)


@model_app.post(source_path, response_model=InferenceAssetOut)
async def import_input(
    request: Request, body: InferenceAssetImportIn, session: SessionDep, owner: OwnerDep
):
    return await mapped(
        InferenceAssets(
            session, owner, settings=model_settings, library=library_inputs(request, session, owner)
        ).import_library(body.asset_id)
    )


def audio():
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\0\0" * 800)
    return output.getvalue()


def unsafe(browser):
    return {"Origin": origin, "X-CSRF-Token": browser.cookies.get("fpl_csrf")}


async def assertion(browser, service, path):
    result = await browser.get(
        "/_internal/v1/authorize",
        headers={
            **unsafe(browser),
            "X-Fpl-Target-Service": service,
            "X-Fpl-Request-Method": "POST",
            "X-Fpl-Request-Uri": path,
        },
    )
    assert result.status_code == 204, result.text
    return result.headers["X-Fpl-Context"]


async def scenario():
    try:
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(identity.router.lifespan_context(identity))
            await stack.enter_async_context(assets.router.lifespan_context(assets))
            async with identity.state.database.sessions() as session:
                for name in ("alpha", "beta"):
                    await create_account(
                        session,
                        username="library-" + name,
                        display_name=name,
                        password=password,
                        platform_role="user",
                    )
            browsers = []
            owners = []
            for name in ("alpha", "beta"):
                browser = await stack.enter_async_context(
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=identity),
                        base_url=origin,
                        headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
                    )
                )
                login = await browser.post(
                    "/v1/auth/login", json={"username": "library-" + name, "password": password}
                )
                assert login.status_code == 200, login.text
                browsers.append(browser)
                owners.append(login.json()["user"]["id"])
            asset_client = await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=assets),
                    base_url="http://assets",
                )
            )
            model_client = await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=model_app),
                    base_url="http://models",
                )
            )
            asset_proof = await assertion(browsers[0], "assets", "/v1/files")
            library = await asset_client.post(
                "/v1/files",
                headers={"X-Fpl-Context": asset_proof},
                files={"upload": ("听写 样例.wav", audio(), "audio/wav")},
            )
            assert library.status_code == 200, library.text
            asset_id = library.json()["id"]
            await AssetReferences(assets.state.database).replace(
                owner=owners[0],
                service="visual",
                update=ReferenceUpdate(
                    request_id="fixture-canvas",
                    resource_kind="canvas",
                    resource_id="fixture-project",
                    resource_revision=0,
                    expected_revision=0,
                    asset_ids=[],
                ),
            )
            project = await asset_client.post(
                "/v1/files",
                headers={"X-Fpl-Context": asset_proof},
                files={"upload": ("工程音频.wav", audio(), "audio/wav")},
                data={"project_id": "fixture-project"},
            )
            assert project.status_code == 200, project.text
            proofs = [await assertion(browser, "models", source_path) for browser in browsers]
            copied = await model_client.post(
                source_path,
                headers={"X-Fpl-Context": proofs[0]},
                json={"asset_id": asset_id},
            )
            assert copied.status_code == 200, copied.text
            assert copied.json()["filename"] == "听写 样例.wav"
            foreign = await model_client.post(
                source_path,
                headers={"X-Fpl-Context": proofs[1]},
                json={"asset_id": asset_id},
            )
            assert foreign.status_code == 404, foreign.text
            project_input = await model_client.post(
                source_path,
                headers={"X-Fpl-Context": proofs[0]},
                json={"asset_id": project.json()["id"]},
            )
            assert project_input.status_code == 404, project_input.text
            private_path = "/_internal/v1/model-library-inputs/" + asset_id
            grant = RequestGrant(
                "models",
                "models.library-input.read",
                "POST",
                source_path,
                "assets",
                "GET",
                private_path,
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=identity), base_url=origin
            ) as raw:
                delegated = await raw.post(
                    "/_internal/v1/authorization/delegate",
                    headers={"Authorization": "Bearer " + model_credential},
                    json={**asdict(grant), "assertion": proofs[0]},
                )
                assert delegated.status_code == 200, delegated.text
                wrong_service = await raw.post(
                    "/_internal/v1/authorization/delegate",
                    headers={"Authorization": "Bearer " + asset_credential},
                    json={**asdict(grant), "assertion": proofs[0]},
                )
                assert wrong_service.status_code == 403
                arbitrary_owner = await raw.post(
                    "/_internal/v1/authorization/delegate",
                    headers={"Authorization": "Bearer " + model_credential},
                    json={**asdict(grant), "assertion": proofs[0], "owner_user_id": owners[1]},
                )
                assert arbitrary_owner.status_code == 422
                created = await browsers[0].post(
                    "/v1/account/api-keys",
                    headers=unsafe(browsers[0]),
                    json={
                        "name": "Read-only fixture",
                        "scopes": ["studio:read"],
                        "expires_in_days": 7,
                    },
                )
                assert created.status_code == 201, created.text
                read_only_source = issue_context(
                    Actor(
                        owners[0],
                        "user",
                        "management_api_key",
                        ("studio:read", "studio:private_read"),
                        api_key_id=created.json()["api_key"]["id"],
                    ),
                    service="models",
                    method="POST",
                    path=source_path,
                    private_key=key,
                    key_id="fixture",
                )
                denied_source = await raw.post(
                    "/_internal/v1/authorization/delegate",
                    headers={"Authorization": "Bearer " + model_credential},
                    json={**asdict(grant), "assertion": read_only_source},
                )
                assert denied_source.status_code == 403, denied_source.text
            token = delegated.json()["assertion"]
            for headers, status in (
                ({}, 401),
                ({"X-Fpl-Context": token, "Origin": origin}, 403),
                ({"X-Fpl-Context": token, "Cookie": "fpl_session=untrusted"}, 403),
            ):
                response = await asset_client.get(private_path, headers=headers)
                assert response.status_code == status, response.text
            response = await asset_client.get(private_path, headers={"X-Fpl-Context": token})
            assert response.status_code == 200 and response.content == audio()
            assert response.headers["cache-control"] == "no-store"
            assert not any(path.startswith("/_internal/") for path in assets.openapi()["paths"])
            logged_out = await browsers[0].post("/v1/auth/logout", headers=unsafe(browsers[0]))
            assert logged_out.status_code == 204, logged_out.text
            revoked_source = await model_client.post(
                source_path,
                headers={"X-Fpl-Context": proofs[0]},
                json={"asset_id": asset_id},
            )
            assert revoked_source.status_code == 401, revoked_source.text
            async with models.sessions(info={"owner_user_id": owners[0]}) as session:
                rows = list(await session.scalars(select(ModelInferenceAsset)))
                assert len(rows) == 1
                path = (
                    model_settings.runtime_path
                    / "accounts"
                    / owners[0]
                    / "model-inference/inputs"
                    / rows[0].storage_key
                )
                assert path.read_bytes() == audio()
            async with models.sessions(info={"owner_user_id": owners[1]}) as session:
                assert not list(await session.scalars(select(ModelInferenceAsset)))
            assert "studio.runtime.database.website" not in sys.modules
            assert "studio.assembly.website.models" not in sys.modules
    finally:
        await capabilities.close()
        await models.close()


asyncio.run(scenario())
