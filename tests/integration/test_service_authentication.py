"""Request identity cannot be forged through cookies or forwarded ingress headers."""

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Request

from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.lifecycle.locking import service_lock


@pytest.mark.asyncio
async def test_service_checks_signature_destination_and_real_request_path():
    key = Ed25519PrivateKey.generate()
    path = "/v1/agent-workbench/sessions"
    catalog = RouteCatalog([Operation("agents", "GET", path, "list_sessions")])
    app = FastAPI()

    @app.get(path)
    async def sessions(request: Request):
        actor = request.state.service_actor
        return {"owner": actor.user_id, "local": actor.local}

    app.add_middleware(
        SignedIdentity, service="agents", public_key=key.public_key(), catalog=catalog
    )
    actor = Actor("one", "user", "session", ("studio:read",), session_id="session-one")
    token = issue_context(
        actor, service="agents", method="GET", path=path, private_key=key, key_id="test"
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agents"
    ) as client:
        assert (
            await client.get(
                path,
                headers={
                    "Cookie": "fpl_session=fake",
                    "X-Fpl-Ingress": "local",
                    "X-Fpl-User": "administrator",
                    "X-Forwarded-Host": "127.0.0.1",
                },
            )
        ).status_code == 401
        response = await client.get(
            path, headers={"X-Fpl-Context": token, "X-Fpl-Ingress": "local"}
        )
        assert response.json() == {"owner": "one", "local": False}
        assert response.headers["Cache-Control"] == "no-store"
        wrong = issue_context(
            actor, service="remote", method="GET", path=path, private_key=key, key_id="test"
        )
        assert (await client.get(path, headers={"X-Fpl-Context": wrong})).status_code == 401
        assert (
            await client.get("/v1/model-entries", headers={"X-Fpl-Context": token})
        ).status_code == 404


def test_service_process_lock_prevents_overlapping_maintenance(tmp_path):
    with service_lock(tmp_path):
        with pytest.raises(RuntimeError, match="另一个实例"):
            with service_lock(tmp_path):
                pytest.fail("overlapping service lock acquired")
    with service_lock(tmp_path):
        assert (tmp_path / ".service.lock").is_file()
