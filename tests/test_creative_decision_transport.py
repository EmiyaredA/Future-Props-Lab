"""Private source-to-target decisions with separate service databases."""

import base64
import json
from uuid import uuid4

import httpx
import jwt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import select

from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
from app.runtime.config import Settings
from fpl_creative.decision_http import InstallDecisionEndpoint
from fpl_creative.decision_http import router as decision_router
from fpl_creative.fence_records import CreativeInstallFence
from fpl_creative.install_authorization import IdentityInstallAuthorization
from fpl_creative.install_grants import InstallGrantAuthority
from fpl_creative.installation_outbox import InstallationOutbox
from fpl_creative.migrations.registry import MIGRATIONS as CREATIVE_MIGRATIONS
from fpl_creative.storage import creative_database
from fpl_integrations.creative_authority import CreativeHttpAuthority
from fpl_integrations.creative_http import router as target_router
from fpl_integrations.creative_installations import CreativeInstallations
from fpl_integrations.migrations.registry import MIGRATIONS as INTEGRATION_MIGRATIONS
from fpl_integrations.models import MODELS
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.creative_install_evidence import INSTALL_PATH, issue_install_evidence
from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeInstallPart
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply


class Live:
    active = True

    async def status(self, **_kwargs):
        return self.active


async def test_private_http_decision_binds_live_user_batch_peer_and_fence(tmp_path):
    creative_root, integration_root = tmp_path / "creative", tmp_path / "integrations"
    creative_root.mkdir()
    integration_root.mkdir()
    apply(creative_root / "service.db", "creative", CREATIVE_MIGRATIONS)
    apply(integration_root / "service.db", "integrations", INTEGRATION_MIGRATIONS)
    creative_db = creative_database(creative_root)
    integration_db = Database(
        "integrations",
        integration_root,
        models=MODELS,
        account_models=tuple(model for model in MODELS if hasattr(model, "owner_user_id")),
    )
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(integration_root / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "alice", "user", "session", ("studio:write", "studio:private_read"), session_id="s"
    )
    token = issue_context(
        actor, service="creative", method="POST", path=INSTALL_PATH, private_key=key, key_id="test"
    )
    claims = jwt.decode(
        token, key.public_key(), algorithms=["EdDSA"], issuer="fpl-identity", audience="creative"
    )
    raw = b'{"release_id":"release","names":{}}'
    evidence = issue_install_evidence(
        actor=actor,
        request_id=claims["jti"],
        raw=raw,
        source_expiry=claims["exp"],
        private_key=key,
        key_id="test",
    )
    source = {
        "assertion": token,
        "evidence": evidence,
        "body_base64": base64.b64encode(raw).decode(),
    }
    part = CreativeInstallPart(
        release_id="release",
        kind="tool_api",
        title="Tool",
        target_name="Tool",
        summary="",
        manifest={"method": "GET", "url": "https://example.test"},
    )
    value = CreativeInstallBatch(operation_id=str(uuid4()), root_release_id="release", parts=[part])
    creative_peer, integration_peer = "c" * 48, "i" * 48
    live = Live()
    try:
        async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
            session.add(
                CreativeItem(
                    id="item",
                    origin_owner_user_id="author",
                    author_user_id="author",
                    kind="tool_api",
                    status="published",
                )
            )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="release", item_id="item", version=1, title="Tool", manifest=part.manifest
                )
            )
            await session.commit()
        outbox = InstallationOutbox(creative_db)
        await outbox.accept("alice", CreativeInstallPreviewIn.model_validate_json(raw), value)
        source_app = FastAPI()
        source_app.include_router(decision_router)
        source_app.state.creative_install_decisions = InstallDecisionEndpoint(
            peer_credential=integration_peer,
            authority=InstallGrantAuthority(
                outbox, IdentityInstallAuthorization(public_key=key.public_key(), identity=live)
            ),
        )
        target = FastAPI()
        target.include_router(target_router)
        target.state.creative_installations = CreativeInstallations(integration_db, settings)
        target.state.creative_authorization = CreativeHttpAuthority(
            creative_peer_credential=creative_peer,
            integrations_credential=integration_peer,
            transport=httpx.ASGITransport(app=source_app),
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=target), base_url="http://integrations"
        ) as client:
            path = "/_internal/v1/creative-integrations/"
            payload = {"batch": value.model_dump(mode="json"), "source": source}
            assert (await client.post(path + "receipt", json=payload)).status_code == 403
            headers = {"Authorization": "Bearer " + creative_peer}
            bad = {
                **payload,
                "source": {
                    **source,
                    "body_base64": base64.b64encode(b'{"release_id":"other"}').decode(),
                },
            }
            assert (
                await client.post(path + "receipt", headers=headers, json=bad)
            ).status_code == 403
            forged = value.model_copy(deep=True)
            forged.parts[0].target_name = "forged"
            assert (
                await client.post(
                    path + "receipt",
                    headers=headers,
                    json={"batch": forged.model_dump(mode="json"), "source": source},
                )
            ).status_code == 403
            assert (
                await client.post(
                    path + "receipt",
                    headers={**headers, "Origin": "https://browser.test"},
                    json=payload,
                )
            ).status_code == 403
            missing = await client.post(path + "receipt", headers=headers, json=payload)
            assert missing.status_code == 404

            class LostDecision(httpx.AsyncBaseTransport):
                async def handle_async_request(self, request):
                    result = await httpx.ASGITransport(app=source_app).handle_async_request(request)
                    await result.aread()
                    await result.aclose()
                    raise httpx.ReadTimeout("decision response lost", request=request)

            target.state.creative_authorization = CreativeHttpAuthority(
                creative_peer_credential=creative_peer,
                integrations_credential=integration_peer,
                transport=LostDecision(),
            )
            unknown = await client.post(
                path + "install",
                headers=headers,
                data={"batch": value.model_dump_json(), "source": json.dumps(source)},
            )
            assert unknown.status_code == 503
            async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
                assert len(list(await session.scalars(select(CreativeInstallFence)))) == 1
            target.state.creative_authorization = CreativeHttpAuthority(
                creative_peer_credential=creative_peer,
                integrations_credential=integration_peer,
                transport=httpx.ASGITransport(app=source_app),
            )
            installed = await client.post(
                path + "install",
                headers=headers,
                data={"batch": value.model_dump_json(), "source": json.dumps(source)},
            )
            assert installed.status_code == 200, installed.text
            receipt = await client.post(path + "receipt", headers=headers, json=payload)
            assert receipt.status_code == 200 and receipt.json() == installed.json()
            cancelled = await client.post(path + "cancel", headers=headers, json=payload)
            assert cancelled.status_code == 200 and cancelled.json() == {
                "state": "committed",
                "receipt": installed.json(),
            }
            live.active = False
            assert (
                await client.post(path + "receipt", headers=headers, json=payload)
            ).status_code == 403
            live.active = True
            # A verified receipt is the only input that may settle this source operation.
            await outbox.complete("alice", "release", receipt.json())
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=source_app), base_url="http://creative"
        ) as client:
            forbidden = await client.post("/_internal/v1/creative-install/decision", json={})
            assert forbidden.status_code == 403
            forbidden_cookie = await client.post(
                "/_internal/v1/creative-install/decision",
                headers={
                    "Authorization": "Bearer " + integration_peer,
                    "Cookie": "session=untrusted",
                },
                json={},
            )
            assert forbidden_cookie.status_code == 403
    finally:
        await creative_db.close()
        await integration_db.close()
