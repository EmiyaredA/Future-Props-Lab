"""Exercise workflow rules using replaceable ports without a database or web app."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from studio.apps.visual_workshop.creative_ports import CardEditContext, CreativeAsset
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.generation.generation_intake import GenerationIntake
from studio.apps.visual_workshop.schemas.creative_workflow import CardData, CardOut, ScriptOut
from studio.contracts.model_service.generation_tasks import ImageGenerationTaskCreateIn
from studio.contracts.visual_workshop.visual_generation import (
    GenerationAssets,
    VisualModelSelection,
    VisualReferenceRules,
)
from studio.runtime.project_errors import ProjectResourceError


async def test_creative_workflow_uses_detached_values_and_external_asset_port():
    identity, image = str(uuid4()), str(uuid4())
    inspect = AsyncMock(return_value={image: CreativeAsset("image", "image/png", None)})

    async def edit(_project, _data, _card, transform):
        candidate = transform(CardEditContext(None, None, ScriptOut(revision=0)))
        assert candidate.media_projects == {image: None}
        return CardOut(id=identity, revision=0, **candidate.data.model_dump())

    store = SimpleNamespace(edit_card=AsyncMock(side_effect=edit))
    saved = await CreativeWorkflow(store, inspect).save_card(
        None, CardData(kind="character", title="设定", adopted_asset_id=image)
    )
    assert saved.id == identity and saved.adopted_asset_id == image
    inspect.assert_awaited_once_with(None, {image})


async def test_creative_rule_rejects_a_wrong_asset_kind_with_an_in_memory_store():
    image = str(uuid4())

    async def edit(_project, _data, _card, transform):
        return transform(CardEditContext(None, None, ScriptOut(revision=0)))

    store = SimpleNamespace(edit_card=AsyncMock(side_effect=edit))
    inspect = AsyncMock(return_value={image: CreativeAsset("video", "video/mp4", None)})
    with pytest.raises(ProjectResourceError) as rejected:
        await CreativeWorkflow(store, inspect).save_card(
            None, CardData(kind="scene", title="错误素材", adopted_asset_id=image)
        )
    assert rejected.value.code == "visual_asset_scope"


@pytest.mark.parametrize("preparation_fails", [False, True])
async def test_generation_uses_capabilities_and_atomic_ports_without_provider_branches(
    preparation_fails,
):
    project, model = str(uuid4()), str(uuid4())
    body = ImageGenerationTaskCreateIn(
        kind="image", model_id=model, prompt="test", size="1024x1024"
    )
    rules = VisualReferenceRules(
        frame_constraints=False, supports_subject=True, frame_reference_slots=False
    )
    selection = VisualModelSelection(
        model_id=model,
        provider_id=str(uuid4()),
        provider_kind="replaceable-provider",
        provider_name="test",
        model_slug="replaceable-model",
        temporary_upload_configured=False,
        reference_rules=rules,
    )
    store = SimpleNamespace(
        pending=AsyncMock(return_value=[]),
        resolve=AsyncMock(return_value=(body, {}, [])),
        start=AsyncMock(),
        commit=AsyncMock(return_value=SimpleNamespace(id="task")),
        abort=AsyncMock(),
    )
    peer = SimpleNamespace(
        model=AsyncMock(return_value=selection),
        assets=AsyncMock(return_value=GenerationAssets(items=[], max_video_bytes=1)),
        prepare=AsyncMock(
            side_effect=ValueError("failed preparation") if preparation_fails else None,
            return_value={},
        ),
    )
    intake = GenerationIntake(store, peer, AsyncMock())
    if preparation_fails:
        with pytest.raises(ValueError, match="failed preparation"):
            await intake.create_task(project, body)
        store.commit.assert_not_awaited()
        store.abort.assert_awaited_once()
    else:
        assert (await intake.create_task(project, body)).id == "task"
        store.commit.assert_awaited_once()
        store.abort.assert_not_awaited()
    store.resolve.assert_awaited_once_with(project, body, rules)
    plan = store.start.await_args.args[0]
    assert "reference_rules" not in plan.model.model_dump()
