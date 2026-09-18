from __future__ import annotations

from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, select

from app.capabilities.agents.harness import ToolExecutionContext
from app.main import app
from app.apps.visual_workshop.models import VisualGenerationTask
from app.llm.models import ModelEntry, ModelProvider
from app.runtime.credentials import encrypt_secret
from app.runtime.db import SessionLocal
from app.apps.visual_workshop.assistant.tools import visual_agent_tools


@pytest.mark.asyncio
async def test_generation_tool_atomically_creates_task_and_canvas_placeholder() -> None:
    provider = ModelProvider(
        id=str(uuid4()),
        name="Agent 图片生成测试",
        kind="senseaudio_image",
        base_url="https://generation.example.test/v1",
        api_key_ciphertext=encrypt_secret("test-only-secret"),
        enabled=True,
        sort_order=-100,
    )
    model = ModelEntry(
        id=str(uuid4()),
        provider_id=provider.id,
        slug="senseaudio-image-2.0-260319",
        label="Agent Image Test",
        capabilities=["image_generation"],
        categories=["image_generation"],
        enabled=True,
        sort_order=0,
    )
    async with SessionLocal() as session:
        session.add(provider)
        await session.commit()
    async with SessionLocal() as session:
        session.add(model)
        await session.commit()

    tool = next(
        item
        for item in visual_agent_tools(image_model_id=model.id)
        if item.name == "start_generation_on_canvas"
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "Agent 原子生成", "kind": "canvas"},
            )
        ).json()
        try:
            arguments = {
                "task": {
                    "kind": "image",
                    "model_id": str(uuid4()),
                    "prompt": "未来道具概念图",
                    "size": "1024x1024",
                },
                "node": {
                    "id": "generated-image-1",
                    "title": "未来道具",
                    "position": {"x": 120, "y": 160},
                },
            }
            observation = await tool.handler(
                arguments,
                ToolExecutionContext(
                    run_id="run-1",
                    tool_call_id="generation-1",
                    scope={
                        "workspace_id": "default",
                        "project_id": project["id"],
                        "image_model_id": model.id,
                    },
                    approved_canvas_revision=0,
                ),
            )

            assert observation.success is True
            assert observation.data["canvas_revision"] == 1
            task_id = observation.data["task"]["id"]
            canvas = (
                await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")
            ).json()
            assert canvas["nodes"][0]["generation_task_id"] == task_id
            async with SessionLocal() as session:
                task = await session.get(VisualGenerationTask, task_id)
                assert task is not None
                assert task.project_id == project["id"]
                assert task.model_id == model.id
            assert tool.summarize(arguments)["model_id"] == model.id

            invalid = {
                **arguments,
                "node": {
                    "id": "invalid-placeholder",
                    "position": {"x": "invalid", "y": 0},
                },
            }
            with pytest.raises(ValidationError):
                await tool.handler(
                    invalid,
                    ToolExecutionContext(
                        run_id="run-2",
                        tool_call_id="generation-2",
                        scope={
                            "workspace_id": "default",
                            "project_id": project["id"],
                            "image_model_id": model.id,
                        },
                        approved_canvas_revision=1,
                    ),
                )
            async with SessionLocal() as session:
                task_count = await session.scalar(
                    select(func.count(VisualGenerationTask.id)).where(
                        VisualGenerationTask.project_id == project["id"]
                    )
                )
                assert task_count == 1
            unchanged = (
                await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")
            ).json()
            assert unchanged["revision"] == 1
            assert len(unchanged["nodes"]) == 1

            async with SessionLocal() as session:
                stored_model = await session.get(ModelEntry, model.id)
                assert stored_model is not None
                stored_model.enabled = False
                await session.commit()
            unavailable = await tool.handler(
                arguments,
                ToolExecutionContext(
                    run_id="run-unavailable",
                    tool_call_id="generation-unavailable",
                    scope={
                        "workspace_id": "default",
                        "project_id": project["id"],
                        "image_model_id": model.id,
                    },
                    approved_canvas_revision=1,
                ),
            )
            assert unavailable.success is False
            assert unavailable.error_code == "configured_model_unavailable"
            assert unavailable.data["model_id"] == model.id
            async with SessionLocal() as session:
                task_count = await session.scalar(
                    select(func.count(VisualGenerationTask.id)).where(
                        VisualGenerationTask.project_id == project["id"]
                    )
                )
                assert task_count == 1
                stored_model = await session.get(ModelEntry, model.id)
                assert stored_model is not None
                stored_model.enabled = True
                await session.commit()

            stale = await tool.handler(
                arguments,
                ToolExecutionContext(
                    run_id="run-3",
                    tool_call_id="generation-3",
                    scope={
                        "workspace_id": "default",
                        "project_id": project["id"],
                        "image_model_id": model.id,
                    },
                    approved_canvas_revision=0,
                ),
            )
            assert stale.success is False
            assert stale.error_code == "canvas_conflict"
        finally:
            await client.delete(
                f"/v1/visual-workshop/projects/{project['id']}",
                params={"expected_revision": 0},
            )

    async with SessionLocal() as session:
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
        await session.commit()
