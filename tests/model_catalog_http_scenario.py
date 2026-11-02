"""Fresh-process HTTP catalogue slice; not a complete or deployable Models service."""

import asyncio
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException

from app.capabilities.identity.permissions import role_scopes
from app.llm.catalog.http_bindings import CatalogBindings
from app.llm.models import (
    LocalModelInstallation,
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
    ModelSupplier,
)
from app.llm.routes.models import catalog, suppliers
from app.problem_details import http_exception_handler, revision_conflict_handler
from app.runtime.orm_base import Base
from app.runtime.revisions import RevisionConflictError
from fpl_models.defaults import OwnedCatalogDefaults
from fpl_models.migrations.registry import MIGRATIONS
from fpl_models.models import AccountDefaults
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

assert "app.runtime.db" not in sys.modules
assert "app.console.models.accounts" not in sys.modules
assert not any(name.startswith("app.apps.") for name in sys.modules)
state = Path(os.environ["CATALOG_TEST_ROOT"]).resolve()
assert state.is_relative_to(Path(tempfile.gettempdir()).resolve())


class NoTasks:
    def __init__(self, _session):
        pass

    async def model_active(self, **_values):
        return False

    async def provider_active(self, **_values):
        return False


async def scenario():
    apply(state / "service.db", "models", MIGRATIONS)
    core = (ModelSupplier, ModelProvider, ModelEntry, ModelCatalogState, LocalModelInstallation)
    database = Database("models", state, models=(*core, AccountDefaults))
    key = Ed25519PrivateKey.generate()
    routes = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service_id, app.state.database = "models", database
    app.state.model_catalog_bindings = CatalogBindings(OwnedCatalogDefaults, NoTasks)
    app.include_router(catalog.router, prefix="/v1")
    app.include_router(suppliers.router, prefix="/v1")
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_middleware(
        SignedIdentity, service="models", public_key=key.public_key(), catalog=routes
    )
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(
                lambda c: Base.metadata.create_all(c, tables=[m.__table__ for m in core])
            )
        for owner in ("alpha", "beta"):
            async with database.sessions(info={"owner_user_id": owner}) as session:
                session.add(ModelCatalogState(owner_user_id=owner, revision=0))
                await session.commit()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://models"
        ) as client:

            async def request(owner, method, path, **options):
                token = issue_context(
                    Actor(
                        owner,
                        "admin",
                        "session",
                        tuple(role_scopes("admin")),
                        session_id="session-" + owner,
                    ),
                    service="models",
                    method=method,
                    path=path.split("?", 1)[0],
                    private_key=key,
                    key_id="fixture",
                )
                return await client.request(
                    method, path, headers={"X-Fpl-Context": token}, **options
                )

            assert (
                await client.get("/v1/model-providers", headers={"Cookie": "fpl_session=forged"})
            ).status_code == 401
            assert (await request("alpha", "GET", "/v1/model-providers")).json()["revision"] == 0
            created = await request(
                "alpha",
                "POST",
                "/v1/model-providers",
                json={
                    "expected_catalog_revision": 0,
                    "name": "Isolated",
                    "kind": "openai",
                },
            )
            assert created.status_code == 200, created.text
            provider = created.json()["provider"]["id"]
            added = await request(
                "alpha",
                "POST",
                f"/v1/model-providers/{provider}/models",
                json={
                    "expected_catalog_revision": 1,
                    "slug": "fixture",
                    "capabilities": ["chat"],
                },
            )
            assert added.status_code == 200, added.text
            model = added.json()["model"]["id"]
            selected = await request(
                "alpha",
                "PUT",
                "/v1/model-catalog/defaults",
                json={
                    "expected_revision": 2,
                    "default_model_ids": {"chat": model},
                },
            )
            assert selected.status_code == 200 and selected.json()["revision"] == 3, selected.text
            conflict = await request(
                "alpha",
                "PUT",
                "/v1/model-catalog/defaults",
                json={
                    "expected_revision": 2,
                    "default_model_ids": {},
                },
            )
            assert conflict.status_code == 409 and conflict.json()["current"][
                "default_model_ids"
            ] == {"chat": model}
            beta = await request("beta", "GET", "/v1/model-providers")
            assert beta.json()["providers"] == [] and beta.json()["default_model_ids"] == {}
            denied = await request(
                "beta", "DELETE", f"/v1/model-providers/{provider}?expected_catalog_revision=0"
            )
            assert denied.status_code == 404
            assert (await request("beta", "GET", "/v1/model-providers")).json()["revision"] == 0
            binding = app.state.model_catalog_bindings
            app.state.model_catalog_bindings = None
            assert (await request("alpha", "GET", "/v1/model-providers")).status_code == 503
            app.state.model_catalog_bindings = binding
            schema = json.loads(Path("web/src/generated/openapi.json").read_text())
            for path, methods in app.openapi()["paths"].items():
                for method, operation in methods.items():
                    assert operation["operationId"] == schema["paths"][path][method]["operationId"]
        with sqlite3.connect(f"file:{database.path}?mode=ro", uri=True) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            assert not {"users", "platform_settings", "visual_assets"}.intersection(tables)
            assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert (
            "app.runtime.db" not in sys.modules and "app.console.models.accounts" not in sys.modules
        )
    finally:
        await database.close()


asyncio.run(scenario())
