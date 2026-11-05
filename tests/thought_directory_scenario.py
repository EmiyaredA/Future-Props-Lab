"""Real Identity directory calls serve an isolated Thought document/community database."""

import asyncio
import os
import tempfile
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from sqlalchemy import event, select

from studio.apps.identity.accounts import create_account
from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from studio.apps.thought_workshop.account_directory import HttpAccountDirectory
from studio.apps.thought_workshop.storage.migrations.registry import (
    MIGRATIONS as THOUGHT_MIGRATIONS,
)
from studio.apps.thought_workshop.storage.models import ThoughtNoteHistory
from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.thought_workshop.transport.website import router as thought_router
from studio.apps.thought_workshop.transport.website.community import router as community_router
from studio.apps.thought_workshop.transport.website.community_tables import (
    router as community_tables_router,
)
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.assembly.independent.identity.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.account_directory import DirectoryQuery
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import account_exception_handler, http_exception_handler

root = Path(os.environ["THOUGHT_DIRECTORY_ROOT"]).resolve()
assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
for service, migrations in (("identity", IDENTITY_MIGRATIONS), ("thought", THOUGHT_MIGRATIONS)):
    apply(root / service / "service.db", service, migrations)
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
credential, gateway = "thought-directory-fixture-" * 3, "directory-gateway-fixture-" * 3
origin, password = "http://127.0.0.1:19000", "Synthetic-Directory-Password-2026!"
identity = create_app(
    state_root=root / "identity",
    catalog=catalog,
    gateway_token=gateway,
    local_origin=origin,
    public_origin="https://studio.example.test",
    private_key=key,
    service_credentials={"thought": credential, "models": "other-service-fixture-" * 3},
)
database = Database("thought", root / "thought", models=MODELS, account_models=ACCOUNT_MODELS)
writers = set()


@event.listens_for(database.engine.sync_engine, "before_cursor_execute")
def detect_writer(connection, _cursor, statement, _params, _context, _many):
    if statement.strip().upper().startswith(("BEGIN IMMEDIATE", "INSERT ", "UPDATE ", "DELETE ")):
        writers.add(id(connection))


@event.listens_for(database.engine.sync_engine, "commit")
@event.listens_for(database.engine.sync_engine, "rollback")
def end_writer(connection):
    writers.discard(id(connection))


class IdentityTransport(httpx.AsyncBaseTransport):
    def __init__(self):
        self.app = httpx.ASGITransport(app=identity)
        self.calls = 0

    async def handle_async_request(self, request):
        assert not writers, "Identity network call while Thought holds a write transaction"
        self.calls += 1
        return await self.app.handle_async_request(request)


transport = IdentityTransport()
thought = FastAPI()
thought.state.database = database
thought.state.thought_directory = DirectoryBindings(
    for_request=lambda request, _session, principal: HttpAccountDirectory(
        principal=principal,
        assertion=request.state.service_assertion,
        source_method=request.method,
        source_path=request.url.path,
        credential=credential,
        catalog=catalog,
        transport=transport,
    )
)
thought.include_router(thought_router, prefix="/v1")
thought.include_router(community_router, prefix="/v1/thought-workshop")
thought.include_router(community_tables_router, prefix="/v1/thought-workshop")
thought.add_middleware(
    SignedIdentity, service="thought", public_key=key.public_key(), catalog=catalog
)
thought.add_exception_handler(AccountError, account_exception_handler)
thought.add_exception_handler(HTTPException, http_exception_handler)
BASE = "/v1/thought-workshop"
COMM = BASE + "/community"


def unsafe(browser):
    return {"Origin": origin, "X-CSRF-Token": browser.cookies.get("fpl_csrf")}


async def proof(browser, method, path):
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


async def request(client, browser, method, path, body=None):
    response = await client.request(
        method, path, headers={"X-Fpl-Context": await proof(browser, method, path)}, json=body
    )
    assert response.status_code == 200, response.text
    return response.json()


def doc(text):
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


async def scenario():
    try:
        async with identity.router.lifespan_context(identity):
            async with identity.state.database.sessions() as session:
                for name in ("alpha", "beta"):
                    await create_account(
                        session,
                        username="directory-" + name,
                        display_name="公开昵称 " + name,
                        password=password,
                        platform_role="user",
                    )
            async with (
                httpx.AsyncClient(
                    transport=transport,
                    base_url=origin,
                    headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
                ) as alpha,
                httpx.AsyncClient(
                    transport=transport,
                    base_url=origin,
                    headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
                ) as beta,
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=thought), base_url="http://thought"
                ) as client,
            ):
                accounts = []
                for browser, name in ((alpha, "alpha"), (beta, "beta")):
                    logged = await browser.post(
                        "/v1/auth/login",
                        json={"username": "directory-" + name, "password": password},
                    )
                    assert logged.status_code == 200, logged.text
                    accounts.append(logged.json()["user"]["id"])
                library = await request(
                    client, alpha, "POST", BASE + "/knowledge-bases", {"title": "隔离知识库"}
                )
                note = await request(
                    client,
                    alpha,
                    "POST",
                    BASE + "/notes",
                    {
                        "title": "公开文档",
                        "knowledge_base_id": library["id"],
                        "expected_knowledge_revision": library["revision"],
                        "document": doc("正文"),
                    },
                )
                fresh_library = await request(
                    client, alpha, "GET", BASE + "/knowledge-bases/" + library["id"]
                )
                table_note = await request(
                    client,
                    alpha,
                    "POST",
                    BASE + "/notes",
                    {
                        "title": "成员表格",
                        "kind": "multitable",
                        "knowledge_base_id": library["id"],
                        "expected_knowledge_revision": fresh_library["revision"],
                    },
                )
                published = await request(
                    client,
                    alpha,
                    "PUT",
                    COMM + "/libraries/" + library["id"] + "/publication",
                    {
                        "expected_revision": 0,
                        "title": "共享目录",
                        "read_only": False,
                        "articles": [
                            {
                                "note_id": note["id"],
                                "expected_revision": 0,
                                "visibility": "public",
                                "members": [{"username": "directory-beta", "role": "edit"}],
                            },
                            {
                                "note_id": table_note["id"],
                                "expected_revision": 0,
                                "visibility": "public",
                                "members": [{"username": "directory-beta", "role": "edit"}],
                            },
                        ],
                    },
                )
                pub_id = published["publication"]["id"]
                viewed = await request(client, beta, "GET", COMM + "/publications/" + pub_id)
                assert viewed["publication"]["author"] == "公开昵称 alpha"
                article_path = COMM + "/publications/" + pub_id + "/notes/" + note["id"]
                current = await request(client, beta, "GET", article_path)
                saved = await request(
                    client,
                    beta,
                    "PUT",
                    article_path,
                    {
                        "expected_revision": current["note"]["revision"],
                        "title": "成员编辑",
                        "document": doc("新的正文"),
                        "tags": [],
                        "schema_version": 3,
                    },
                )
                assert saved["note"]["title"] == "成员编辑"
                async with database.sessions(info={"owner_user_id": accounts[0]}) as session:
                    histories = list(
                        await session.scalars(
                            select(ThoughtNoteHistory).where(
                                ThoughtNoteHistory.note_id == note["id"]
                            )
                        )
                    )
                    assert histories[-1].author_name == "公开昵称 beta"
                permission_path = COMM + "/publications/" + pub_id + "/permissions"
                configured = await request(
                    client, alpha, "GET", permission_path + "?note_id=" + note["id"]
                )
                await request(
                    client,
                    alpha,
                    "PUT",
                    permission_path,
                    {
                        "articles": [
                            {
                                "note_id": note["id"],
                                "expected_revision": configured[0]["revision"],
                                "visibility": "public",
                                "members": [{"username": "directory-beta", "role": "edit"}],
                            }
                        ]
                    },
                )
                community_table = (
                    COMM + "/publications/" + pub_id + "/notes/" + table_note["id"] + "/multitable"
                )
                structure = await request(client, beta, "GET", community_table)
                table = structure["tables"][0]
                person = {
                    "id": "directory-person",
                    "name": "记录人",
                    "type": "person",
                    "position": len(table["fields"]),
                    "options": [],
                    "config": {"allow_multiple": True, "default_user_ids": []},
                }
                table["fields"].append(person)
                await request(
                    client,
                    beta,
                    "POST",
                    community_table + "/operations",
                    {
                        "expected_revision": table_note["revision"],
                        "operations": [
                            {"op": "table.put", "table": table},
                            {
                                "op": "records.put",
                                "table_id": table["id"],
                                "records": [
                                    {
                                        "id": "directory-record",
                                        "position": 0,
                                        "values": {person["id"]: [accounts[0]]},
                                    }
                                ],
                            },
                        ],
                    },
                )
                people = await request(
                    client, beta, "POST", community_table + "/tables/" + table["id"] + "/query", {}
                )
                assert people["people"] == {accounts[0]: "公开昵称 alpha"}
                # Directory replies contain public names and a separate caller snapshot.
                statement = await proof(alpha, "GET", BASE + "/knowledge-bases")
                directory = HttpAccountDirectory(
                    principal=StudioPrincipal(
                        user_id=accounts[0],
                        platform_role="user",
                        must_change_password=False,
                        auth_kind="session",
                        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                        session_id="unused",
                    ),
                    assertion=statement,
                    source_method="GET",
                    source_path=BASE + "/knowledge-bases",
                    credential=credential,
                    catalog=catalog,
                    transport=transport,
                )
                names = await directory.profiles(ids=accounts)
                assert len(names) == 2
                for name in names:
                    assert set(name.model_dump()) <= {"id", "username", "display_name", "active"}, (
                        name
                    )
                # Changed digests and direct browser access are refused.
                query = DirectoryQuery(ids=accounts)
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://identity"
                ) as raw:
                    delegated = await raw.post(
                        "/_internal/v1/authorization/delegate",
                        headers={"Authorization": "Bearer " + credential},
                        json={
                            "caller": "thought",
                            "purpose": "thought.accounts.read",
                            "source_method": "GET",
                            "source_path": BASE + "/knowledge-bases",
                            "target_service": "identity",
                            "target_method": "POST",
                            "target_path": query.path,
                            "assertion": statement,
                        },
                    )
                    assert delegated.status_code == 200, delegated.text
                    token = delegated.json()["assertion"]
                    response = await raw.post(
                        query.path, json=query.model_dump(), headers={"X-Fpl-Context": token}
                    )
                    assert (
                        response.status_code == 200
                        and response.headers["cache-control"] == "no-store"
                    )
                    assert not any(
                        field in response.text
                        for field in ("password_hash", "email", "session_id", "scopes")
                    )
                    assert (
                        await raw.post(
                            query.path,
                            json={"ids": [accounts[0]]},
                            headers={"X-Fpl-Context": token},
                        )
                    ).status_code == 422
                    assert (
                        await raw.post(
                            query.path,
                            json=query.model_dump(),
                            headers={"X-Fpl-Context": token, "Origin": origin},
                        )
                    ).status_code == 403
                    assert (await raw.post(query.path, json=query.model_dump())).status_code == 401
                    assert (
                        await alpha.post("/v1/auth/logout", headers=unsafe(alpha))
                    ).status_code == 204
                    assert (
                        await raw.post(
                            query.path, json=query.model_dump(), headers={"X-Fpl-Context": token}
                        )
                    ).status_code == 401
                    stale = await client.get(
                        BASE + "/knowledge-bases", headers={"X-Fpl-Context": statement}
                    )
                    assert stale.status_code == 401, stale.text
                assert not any(
                    path.startswith("/_internal/") for path in identity.openapi()["paths"]
                )
                print(
                    "owned Thought directory, community and writer boundaries passed",
                    transport.calls,
                )
    finally:
        await database.close()


asyncio.run(scenario())
