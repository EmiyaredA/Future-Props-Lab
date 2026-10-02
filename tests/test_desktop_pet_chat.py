from __future__ import annotations

import json

import httpx
import pytest

from app.apps.desktop_pet.chat import DesktopPetChats, stream_reply
from app.apps.desktop_pet.chat_schemas import PetChatSendIn
from app.apps.desktop_pet.models import DesktopPetProject
from app.apps.desktop_pet.schemas import PetConfig
from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from app.console.governance.platform_policy import CAPABILITIES
from app.console.models.accounts import User
from app.deps import SessionDep, require_studio_auth
from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.models.model_service import ModelEntry, ModelProvider
from app.llm.providers.streaming import TextDelta
from app.main import app
from app.orm import bind_workspace
from app.runtime.credentials import encrypt_secret
from app.runtime.db import SessionLocal


@pytest.mark.asyncio
async def test_desktop_pet_chat_is_scoped_revisioned_and_streams(monkeypatch):
    async with SessionLocal() as session:
        if not await session.get(User, "test-user"):
            session.add(
                User(
                    id="test-user",
                    username="pet-test",
                    username_normalized="pet-test",
                    password_hash="test",
                )
            )
        session.add(
            User(
                id="pet-other-user",
                username="pet-other",
                username_normalized="pet-other",
                password_hash="test",
            )
        )
        pet = DesktopPetProject(
            workspace_id="default",
            source_type="live2d",
            source_revision=0,
            source_title="test",
            title="小鱼",
            config=PetConfig().model_dump(mode="json", by_alias=True),
        )
        provider = ModelProvider(
            workspace_id="default",
            name="fake",
            kind="openai",
            base_url="https://example.invalid/v1",
            api_key_ciphertext=encrypt_secret("fake"),
        )
        session.add_all([pet, provider])
        await session.flush()
        model = ModelEntry(
            workspace_id="default", provider_id=provider.id, slug="fake-text", capabilities=["chat"]
        )
        session.add(model)
        await session.commit()
        pet_id, model_id = pet.id, model.id

    calls: list[str] = []

    async def fake_stream(_model, *, system_prompt, messages):
        calls.append(messages[-1].text)
        assert "小鱼" in system_prompt
        yield TextDelta(text="你")
        yield TextDelta(text="好", completion_tokens=2)

    monkeypatch.setattr("app.apps.desktop_pet.chat.stream_product_text", fake_stream)
    base = f"/v1/desktop-pet/projects/{pet_id}/chat"
    assert route_permission("GET", base) == "models.use"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        initial = await client.get(base)
        assert initial.status_code == 200 and initial.json()["revision"] == 0
        settings = await client.patch(
            base,
            json={
                "expectedRevision": 0,
                "modelId": model_id,
                "proactiveLinesEnabled": False,
            },
        )
        assert settings.status_code == 200, settings.text
        assert settings.json()["revision"] == 1
        assert settings.json()["proactiveLinesEnabled"] is False
        assert (
            await client.patch(
                base,
                json={
                    "expectedRevision": 0,
                    "modelId": model_id,
                    "proactiveLinesEnabled": True,
                },
            )
        ).status_code == 409
        body = {"expectedRevision": 1, "requestId": "fixed-request", "content": "嗨"}
        response = await client.post(base + "/messages/stream", json=body)
        assert response.status_code == 200, response.text
        events = [
            json.loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        assert [event["type"] for event in events] == ["start", "delta", "delta", "done"]
        assert events[-1]["message"]["content"] == "你好"
        assert calls == ["嗨"]

        assert (await client.post(base + "/messages/stream", json=body)).status_code == 409
        assert calls == ["嗨"]

        history = await client.get(base)
        assert [item["role"] for item in history.json()["messages"]] == ["user", "assistant"]
        older = await client.get(base + "/messages", params={"before": 2, "limit": 1})
        assert older.status_code == 200
        assert [item["role"] for item in older.json()["items"]] == ["user"]
        revision = history.json()["revision"]

        original = app.dependency_overrides[require_studio_auth]

        async def other_user(session: SessionDep) -> StudioPrincipal:
            bind_workspace(session, "default")
            return StudioPrincipal(
                user_id="pet-other-user",
                workspace_id="default",
                membership_id="other",
                workspace_access="owner",
                member_role="owner",
                is_platform_admin=True,
                platform_role="super_admin",
                platform_permissions=frozenset(CAPABILITIES),
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other-session",
            )

        app.dependency_overrides[require_studio_auth] = other_user
        try:
            separate = await client.get(base)
            assert separate.status_code == 200
            assert separate.json()["messages"] == [] and separate.json()["modelId"] is None

        finally:
            app.dependency_overrides[require_studio_auth] = original
        cleared = await client.request(
            "DELETE", base + "/messages", json={"expectedRevision": revision}
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["messages"] == []
        assert (
            await client.post(
                base + "/messages/stream",
                json={
                    **body,
                    "expectedRevision": cleared.json()["revision"],
                },
            )
        ).status_code == 409
        assert calls == ["嗨"]

        async def broken_stream(_model, **_kwargs):
            yield TextDelta(text="半")
            raise RuntimeError("network gone")

        monkeypatch.setattr("app.apps.desktop_pet.chat.stream_product_text", broken_stream)
        failed = await client.post(
            base + "/messages/stream",
            json={
                "expectedRevision": cleared.json()["revision"],
                "requestId": "failed-request",
                "content": "还在吗",
            },
        )
        assert failed.status_code == 200
        assert '"type":"error"' in failed.text
        interrupted = (await client.get(base)).json()
        assert interrupted["active"] is False
        assert interrupted["messages"][-1]["status"] == "interrupted"

    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        prepared = await DesktopPetChats(session, "default", "test-user").prepare_send(
            pet_id,
            PetChatSendIn(
                expectedRevision=interrupted["revision"],
                requestId="cancel-request",
                content="取消",
            ),
            CredentialSnapshot(auth_kind="session"),
        )
    events = stream_reply(prepared)
    assert '"type":"start"' in await anext(events)
    await events.aclose()
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        cancelled = await DesktopPetChats(session, "default", "test-user").get(pet_id)
        assert cancelled.active is False
        assert cancelled.messages[-1].status == "interrupted"
        entry = await session.get(ModelEntry, model_id)
        assert entry is not None
        entry.enabled = False
        await session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        unavailable = await client.post(
            base + "/messages/stream",
            json={
                "expectedRevision": cancelled.revision,
                "requestId": "unavailable-request",
                "content": "模型还在吗",
            },
        )
        assert unavailable.status_code == 409


def test_legacy_pet_lines_and_limits():
    value = PetConfig.model_validate(
        {
            "schemaVersion": 1,
            "events": {"click": {"bubble": "你好"}},
            "habits": {"hoverActions": ["dress", "roam", "hide"]},
        }
    )
    assert value.events["click"].lines == ["你好"]
    assert value.habits.hover_actions == ["dress", "roam", "hide", "chat"]
    with pytest.raises(ValueError):
        PetConfig.model_validate({"events": {"idle": {"lines": ["x"] * 9}}})
    with pytest.raises(ValueError):
        PetConfig.model_validate({"events": {"idle": {"lines": ["x" * 141]}}})
