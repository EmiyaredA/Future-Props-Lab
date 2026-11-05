"""Fresh-process protocol journey; native files and every database are disposable fixtures."""

import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.apps.agent_workbench.supervisor import CollectionSupervisor
from studio.assembly.independent.agent_workbench.application import create_app
from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.runtime.database.migrations import apply

assert (
    "studio.assembly.website.application" not in sys.modules
    and "studio.assembly.website.models" not in sys.modules
)
assert "studio.apps.identity.storage.models.accounts" not in sys.modules
assert "studio.runtime.database.website" not in sys.modules
assert not any(
    name.startswith(
        (
            "studio.apps.model_service",
            "studio.host.session_collection.parsers",
            "studio.apps.visual_workshop",
        )
    )
    for name in sys.modules
)

from studio.host.receipts import ReceiptStore  # noqa: E402
from studio.host.session_collection.agent_sources import OPERATIONS, execute  # noqa: E402

state = Path(os.environ["AGENTS_TEST_ROOT"])
native_root = state.parent / "native"
native_root.mkdir()
(native_root / "reference.bin").write_bytes(b"private native attachment")
key = Ed25519PrivateKey.generate()


class Identity:
    active_session = True
    available = True

    async def active(self, **_kwargs):
        return self.active_session

    async def owner_permission(self, **_kwargs):
        return {"allowed": self.available, "available": self.available, "revision": 0}

    async def close(self):
        pass


identity = Identity()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
app = create_app(
    state_root=state,
    catalog=catalog,
    public_key=key.public_key(),
    identity=identity,
    native_ingress_token="private-native-ingress-" * 3,
    workers={"collector": "private-native-worker-" * 3},
    collect=False,
)
published = json.loads(Path("web/src/generated/openapi.json").read_text())
assert public_contract(app.openapi(), "agents", catalog) == public_contract(
    published, "agents", catalog
)
apply(state / "service.db", "agents", MIGRATIONS)
native_headers = {
    "X-Fpl-Native-Ingress": "private-native-ingress-" * 3,
    "Authorization": "Bearer " + "private-native-worker-" * 3,
}
receipts = ReceiptStore(state.parent / "receipts", readonly_operations=OPERATIONS)


def actor_headers(method, path, *, owner="alpha", local=True, role="admin"):
    token = issue_context(
        Actor(
            owner,
            role,
            "session",
            ("studio:read", "studio:private_read", "studio:write"),
            session_id="session-" + owner,
            local=local,
        ),
        service="agents",
        method=method,
        path=path,
        private_key=key,
        key_id="test",
    )
    return {"X-Fpl-Context": token}


async def journey():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://agents"
        ) as client:
            assert (
                await client.post("/_native/v1/claim", json={"wait_seconds": 0})
            ).status_code == 403
            assert (await client.get("/v1/agent-workbench/sources")).status_code == 401
            path = "/v1/agent-workbench/sources"
            ordinary = await client.get(path, headers=actor_headers("GET", path, role="user"))
            assert ordinary.status_code == 403
            stop = asyncio.Event()

            async def collector():
                while not stop.is_set():
                    response = await client.post(
                        "/_native/v1/claim", headers=native_headers, json={"wait_seconds": 0}
                    )
                    assert response.status_code == 200, response.text
                    value = response.json()["lease"]
                    if not value:
                        await asyncio.sleep(0.01)
                        continue
                    lease = NativeLease.model_validate(value)
                    assert lease.operation != "agent_sources.follow"
                    outcome = await asyncio.to_thread(receipts.execute, lease, execute)
                    response = await client.post(
                        "/_native/v1/receipt",
                        headers=native_headers,
                        json={"lease": value, "outcome": outcome.model_dump(mode="json")},
                    )
                    assert response.status_code == 200, response.text
                    receipts.acknowledge(lease)

            task = asyncio.create_task(collector())
            body = {"agent_id": "codex", "label": "native source", "root": str(native_root)}
            path = "/v1/agent-workbench/sources"
            public = await client.post(
                path, headers=actor_headers("POST", path, local=False), json=body
            )
            assert public.status_code == 403
            response = await client.post(path, headers=actor_headers("POST", path), json=body)
            assert response.status_code == 201, response.text
            source = response.json()
            stop.set()
            await task
            async with app.state.database.sessions(info={"allow_system_reads": True}) as db:
                from studio.apps.agent_workbench.storage.models import WorkbenchSource

                row = await db.get(WorkbenchSource, source["id"])
            await CollectionSupervisor(app.state.database, identity).ensure(row, 0)
            claim = await client.post(
                "/_native/v1/claim", headers=native_headers, json={"wait_seconds": 0}
            )
            lease = claim.json()["lease"]
            assert lease["operation"] == "agent_sources.follow"
            snapshot = await client.post(
                "/_native/v1/snapshot", headers=native_headers, json={"lease": lease}
            )
            assert snapshot.status_code == 200 and snapshot.json()["owner"] == "alpha"
            frame = {
                "lease": lease,
                "frame_id": str(uuid4()),
                "locator": "rollout-fixture.jsonl",
                "expected": {},
                "batch": {
                    "info": {
                        "native_id": "native-one",
                        "title": "Native title",
                        "origins": ["cli"],
                    },
                    "entries": [
                        {
                            "native_id": "message-one",
                            "ordinal": 0,
                            "role": "user",
                            "kind": "message",
                            "text": "searchable native message",
                            "attachments": [
                                {
                                    "id": "attachment-one",
                                    "name": "reference.bin",
                                    "reference": str(native_root / "reference.bin"),
                                }
                            ],
                        }
                    ],
                    "checkpoint": {"offset": 300, "complete": True},
                },
            }
            for _ in range(2):
                response = await client.post(
                    "/_native/v1/projection", headers=native_headers, json=frame
                )
                assert response.status_code == 200 and response.json()["applied"] is True, (
                    response.text
                )
            assert (await client.get("/ready")).status_code == 503
            directories = "/v1/agent-workbench/execution/directories"
            denied = await client.get(
                directories,
                headers=actor_headers("GET", directories),
                params={"parent": "/fixture/project"},
            )
            assert denied.status_code == 503, denied.text
            register = "/v1/agent-workbench/execution/projects"
            denied = await client.post(
                register,
                headers=actor_headers("POST", register),
                json={"root": "/fixture/project"},
            )
            assert denied.status_code == 503, denied.text
            chats_path = "/v1/agent-workbench/chats"
            assert (
                await client.get(chats_path, headers=actor_headers("GET", chats_path))
            ).json() == []
            assert (
                await client.post(
                    chats_path,
                    headers=actor_headers("POST", chats_path),
                    json={"project_id": "isolated", "agent_id": "codex"},
                )
            ).status_code == 503
            sessions_path = "/v1/agent-workbench/sessions"
            response = await client.get(sessions_path, headers=actor_headers("GET", sessions_path))
            session_id = response.json()["items"][0]["id"]
            assert response.json()["items"][0]["native_id"] == "native-one"
            response = await client.get(
                sessions_path, headers=actor_headers("GET", sessions_path, owner="beta")
            )
            assert response.json()["items"] == []
            history_path = f"{sessions_path}/{session_id}/history"
            history = await client.get(history_path, headers=actor_headers("GET", history_path))
            assert len(history.json()["items"]) == 1, history.text
            secret = await client.get(
                history_path, headers=actor_headers("GET", history_path, owner="beta")
            )
            assert secret.status_code == 404
            bad_frame = json.loads(json.dumps(frame))
            bad_frame["batch"]["entries"][0]["text"] = "must not overwrite same receipt"
            conflict = await client.post(
                "/_native/v1/projection", headers=native_headers, json=bad_frame
            )
            assert conflict.status_code == 409
            stop.clear()
            task = asyncio.create_task(collector())
            attachment_path = f"{sessions_path}/{session_id}/attachments/attachment-one"
            attachment = await client.get(
                attachment_path, headers=actor_headers("GET", attachment_path)
            )
            assert attachment.status_code == 200
            assert attachment.content == b"private native attachment"
            stop.set()
            await task
            identity.active_session = False
            event_path = "/v1/agent-workbench/events"
            events = await client.get(event_path, headers=actor_headers("GET", event_path))
            assert "auth_expired" in events.text
            identity.active_session = True
            from tests.native_follow_scenario import verify_follow

            await verify_follow(
                client, native_headers, lease, source, native_root, actor_headers, identity
            )
            async with app.state.database.engine.connect() as connection:
                tables = set(
                    (
                        await connection.exec_driver_sql(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    ).scalars()
                )
                assert "users" not in tables and "visual_workshop_projects" not in tables
                assert "agent_workbench_sessions" in tables
                assert "workbench_projects" in tables
    assert (native_root / "reference.bin").read_bytes() == b"private native attachment"


asyncio.run(journey())
print("Independent workbench ownership, native transport, checkpoints and revocation passed")
