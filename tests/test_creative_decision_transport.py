"""Private source-to-target decisions with separate service databases."""

import base64
import json
from dataclasses import replace
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import select

from studio.apps.creative_workshop.install_authorization import (
    IdentityInstallAuthorization,
    InstallSource,
)
from studio.apps.creative_workshop.install_batch import build_install_batch
from studio.apps.creative_workshop.install_grants import InstallGrantAuthority
from studio.apps.creative_workshop.install_target import HttpCreativeInstallTarget
from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator
from studio.apps.creative_workshop.installation_outbox import InstallationOutbox
from studio.apps.creative_workshop.skill_archive import CreativeSkillArchives, SkillArchivePacker
from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migrations.registry import (
    MIGRATIONS as CREATIVE_MIGRATIONS,
)
from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease
from studio.apps.creative_workshop.transport.decision_http import InstallDecisionEndpoint
from studio.apps.creative_workshop.transport.decision_http import router as decision_router
from studio.apps.integrations.creative_authority import CreativeHttpAuthority
from studio.apps.integrations.creative_installations import CreativeInstallations
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.apps.integrations.storage.service_models import MODELS
from studio.apps.integrations.transport.creative_http import router as target_router
from studio.config.settings import Settings
from studio.contracts.creative_workshop.catalog import CreativeInstallPreviewIn
from studio.contracts.creative_workshop.creative_install_evidence import (
    INSTALL_PATH,
    issue_install_evidence,
)
from studio.contracts.creative_workshop.creative_integrations import (
    CreativeInstallBatch,
    CreativeInstallPart,
)
from studio.contracts.identity.claims import Actor, issue_context
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


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
        outbox = InstallationOutbox(creative_db, skill_root=creative_root)
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
            result_credential="r" * 48,
            transport=httpx.ASGITransport(app=source_app),
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=target), base_url="http://integrations"
        ) as client:
            path = "/_internal/v1/creative-integrations/"
            payload = {"batch": value.model_dump(mode="json"), "source": source}
            assert (await client.post(path + "receipt", json=payload)).status_code == 403
            headers = {"Authorization": "Bearer " + creative_peer, "X-Fpl-Creative-Nonce": "a" * 32}
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
                result_credential="r" * 48,
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
                result_credential="r" * 48,
                transport=httpx.ASGITransport(app=source_app),
            )
            source_value = InstallSource(token, evidence, raw)
            target_client = HttpCreativeInstallTarget(
                creative_peer_credential=creative_peer,
                result_credential="r" * 48,
                transport=httpx.ASGITransport(app=target),
            )
            coordinator = InstallationCoordinator(
                outbox,
                IdentityInstallAuthorization(public_key=key.public_key(), identity=live),
                target_client,
            )
            installed = await coordinator.install(
                source_value, CreativeInstallPreviewIn.model_validate_json(raw), value
            )
            signed_receipt = await target_client.receipt(source_value, value)
            receipt = await target_client.verify_receipt(source_value, value, signed_receipt)
            assert receipt["resources"] == installed.resources
            with pytest.raises(ValueError):
                await target_client.verify_receipt(
                    source_value, value, replace(signed_receipt, body=b"{}")
                )
            with pytest.raises(ValueError):
                await target_client.verify_receipt(
                    source_value, value, replace(signed_receipt, nonce="b" * 32)
                )
            signed_cancel = await target_client.cancel(source_value, value)
            cancelled = await target_client.verify_cancellation(source_value, value, signed_cancel)
            assert cancelled["state"] == "committed"
            assert (
                await target_client.verify_receipt(source_value, value, cancelled["receipt"])
                == receipt
            )
            live.active = False
            assert (
                await client.post(path + "receipt", headers=headers, json=payload)
            ).status_code == 403
            live.active = True
            assert (await outbox.get("alice", "release")).state == "completed"
            async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
                assert list(await session.scalars(select(CreativeInstallFence))) == []
            async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
                session.add(
                    CreativeItem(
                        id="item-two",
                        origin_owner_user_id="author",
                        author_user_id="author",
                        kind="tool_api",
                        status="published",
                    )
                )
                await session.flush()
                session.add(
                    CreativeRelease(
                        id="release-two",
                        item_id="item-two",
                        version=1,
                        title="Other",
                        manifest=part.manifest,
                    )
                )
                await session.commit()
            raw_two = b'{"release_id":"release-two","names":{}}'
            token_two = issue_context(
                actor,
                service="creative",
                method="POST",
                path=INSTALL_PATH,
                private_key=key,
                key_id="test",
            )
            claims_two = jwt.decode(
                token_two,
                key.public_key(),
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
            )
            evidence_two = issue_install_evidence(
                actor=actor,
                request_id=claims_two["jti"],
                raw=raw_two,
                source_expiry=claims_two["exp"],
                private_key=key,
                key_id="test",
            )
            source_two = InstallSource(token_two, evidence_two, raw_two)
            part_two = part.model_copy(
                update={"release_id": "release-two", "title": "Other", "target_name": "Other"}
            )
            batch_two = CreativeInstallBatch(
                operation_id=str(uuid4()), root_release_id="release-two", parts=[part_two]
            )
            request_two = CreativeInstallPreviewIn.model_validate_json(raw_two)
            await outbox.accept("alice", request_two, batch_two)
            await outbox.fence_for_install("alice", request_two, batch_two)
            assert await coordinator.cancel(source_two, request_two) == {"state": "cancelled"}
            assert (await outbox.get("alice", "release-two")).state == "cancelled"
            async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
                assert list(await session.scalars(select(CreativeInstallFence))) == []
            skill_dir = (
                creative_root / "accounts/author/creative-workshop/skill-releases/skill-release"
            )
            skill_dir.mkdir(parents=True)
            skill_content = b"---\nname: sample\ndescription: Public skill\n---\n# Skill\n"
            (skill_dir / "SKILL.md").write_bytes(skill_content)
            async with creative_db.sessions(info={"owner_user_id": "author"}) as session:
                session.add(
                    CreativeItem(
                        id="skill-item",
                        origin_owner_user_id="author",
                        author_user_id="author",
                        kind="skill",
                        status="published",
                    )
                )
                await session.flush()
                session.add(
                    CreativeRelease(
                        id="skill-release",
                        item_id="skill-item",
                        version=1,
                        title="Skill",
                        manifest={
                            "name": "sample",
                            "description": "Public skill",
                            "content_sha256": "a" * 64,
                            "file_count": 1,
                            "expanded_bytes": len(skill_content),
                        },
                        skill_path="creative-workshop/skill-releases/skill-release",
                    )
                )
                await session.commit()
            raw_skill = b'{"release_id":"skill-release","names":{}}'
            token_skill = issue_context(
                actor,
                service="creative",
                method="POST",
                path=INSTALL_PATH,
                private_key=key,
                key_id="test",
            )
            claims_skill = jwt.decode(
                token_skill,
                key.public_key(),
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
            )
            evidence_skill = issue_install_evidence(
                actor=actor,
                request_id=claims_skill["jti"],
                raw=raw_skill,
                source_expiry=claims_skill["exp"],
                private_key=key,
                key_id="test",
            )
            source_skill = InstallSource(token_skill, evidence_skill, raw_skill)
            request_skill = CreativeInstallPreviewIn.model_validate_json(raw_skill)
            packer = SkillArchivePacker(
                root=creative_root,
                max_files=settings.fpl_skill_max_files,
                max_expanded_bytes=settings.fpl_skill_expanded_max_bytes,
                max_archive_bytes=settings.fpl_skill_archive_max_bytes,
            )
            batch_skill = await build_install_batch(creative_db, packer, request_skill)
            target_client.archives = CreativeSkillArchives(creative_db, packer)
            installed_skill = await coordinator.install(source_skill, request_skill, batch_skill)
            resource = installed_skill.resources[0]["resource_id"]
            installed_path = (
                settings.runtime_path
                / "accounts/alice/integrations/skills"
                / resource
                / "v1/SKILL.md"
            )
            assert installed_path.read_bytes() == skill_content
            assert (await outbox.get("alice", "skill-release")).state == "completed"
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
