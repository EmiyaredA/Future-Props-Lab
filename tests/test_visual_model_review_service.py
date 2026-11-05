"""Exercise the fixed Models review plan and provider receipt under real Identity grants."""

import asyncio
import base64
import io
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from PIL import Image
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize

from app.llm.models import ModelEntry, ModelProvider
from app.llm.visual_review import Suggestions
from fpl_models.migrations.registry import MIGRATIONS
from fpl_models.models import ACCOUNT_MODELS, MODELS
from fpl_models.visual_review_attempts import UNKNOWN, VisualReviewAttempts
from fpl_models.visual_review_http import router
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.claims import HEADER
from fpl_runtime.database import Database
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.visual_review import MODEL_PLAN, PLAN_PURPOSE, RUN_PURPOSE, ReviewModelRun


async def test_visual_model_reviews_replay_exact_result_and_never_resubmit_unknown(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    credential = "isolated-fixed-vision-models-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        visual=CREDENTIALS["visual"],
        models=credential,
    )
    root = tmp_path / "models"
    apply(root / "service.db", "models", MIGRATIONS)
    database = Database("models", root, models=MODELS, account_models=ACCOUNT_MODELS)
    async with database.sessions(info={"owner_user_id": case.viewer}) as session:
        provider = ModelProvider(
            name="Isolated fixed provider",
            kind="openai",
            base_url="https://provider.example.test/v1",
            api_key_ciphertext="private-credential",
        )
        session.add(provider)
        await session.flush()
        model = ModelEntry(
            provider_id=provider.id, slug="fixture-vision", capabilities=["chat", "vision"]
        )
        session.add(model)
        await session.flush()
        model_id = model.id
        await session.commit()
    models = FastAPI()
    models.state.database = database
    models.state.identity_public_key = case.key.public_key()
    models.state.identity = LiveAuthorization(
        service="models", credential=credential, transport=case.mesh
    )
    models.state.settings = SimpleNamespace(
        fpl_acceptance_model_owner_user_id=case.viewer, fpl_acceptance_model_id=model_id
    )
    attempts = VisualReviewAttempts(models.state)
    models.state.visual_review_attempts = attempts
    models.include_router(router)
    case.mesh.apps["models"] = models
    peer = CapabilityClient(
        service="visual", credential=CREDENTIALS["visual"], catalog=CATALOG, transport=case.mesh
    )
    source = "/v1/visual-workshop/projects/fixture/nodes/video/acceptance/runs"
    original = (await authorize(case, "visual", "POST", source))[HEADER]
    image = io.BytesIO()
    Image.new("RGB", (12, 12), "red").save(image, "JPEG")

    async with models.state.identity.client, peer.client:

        async def send(method, target, purpose, **kwargs):
            token = await peer.authorize_request(
                original, RequestGrant("visual", purpose, "POST", source, "models", method, target)
            )
            return await peer.client.request(
                method, "http://models" + target, headers={HEADER: token}, **kwargs
            )

        plan = await send("GET", MODEL_PLAN, PLAN_PURPOSE)
        assert plan.status_code == 200, plan.text
        assert "private-credential" not in plan.text and "base_url" not in plan.text
        body = ReviewModelRun(
            project_id="fixture",
            run_id=str(uuid4()),
            model=plan.json(),
            criteria=[{"id": "criterion", "method": "ai"}],
            evidence=[
                {
                    "id": "evidence",
                    "asset_id": "image",
                    "source_asset_id": "video",
                    "position_ms": 120,
                    "jpeg_base64": base64.b64encode(image.getvalue()).decode(),
                }
            ],
            coverage="Limited fixture frames",
            prompt="Fixture prompt",
        )
        calls = []

        async def evaluate(_args, payload, images, usage, _transport):
            calls.append(payload["prompt"])
            assert images[0].byte_size == len(image.getvalue())
            usage["prompt_tokens"] = 11
            return Suggestions.model_validate(
                {
                    "results": [
                        {
                            "criterion_id": "criterion",
                            "verdict": "passed",
                            "explanation": "Frame matched",
                            "evidence_ids": ["evidence"],
                        }
                    ]
                }
            )

        monkeypatch.setattr(
            "fpl_models.visual_review_attempts.decrypt_secret", lambda _: "fixture-key"
        )
        monkeypatch.setattr("fpl_models.visual_review_attempts.evaluate_review", evaluate)

        async def execute(value):
            return await send("POST", value.path, RUN_PURPOSE, json=value.model_dump(mode="json"))

        completed = await execute(body)
        assert completed.status_code == 200, completed.text
        assert completed.json()["results"]["results"][0]["evidence_ids"] == ["evidence"]
        assert completed.json()["usage"] == {"prompt_tokens": 11}
        assert (await execute(body)).json() == completed.json()
        assert (await execute(body.model_copy(update={"prompt": "Changed"}))).status_code == 409
        assert calls == ["Fixture prompt"]

        async def interrupt(*_args):
            calls.append("interrupted provider call")
            raise asyncio.CancelledError

        monkeypatch.setattr("fpl_models.visual_review_attempts.evaluate_review", interrupt)
        unknown = body.model_copy(update={"run_id": str(uuid4())})
        with pytest.raises(asyncio.CancelledError):
            await execute(unknown)
        await attempts.recover()
        assert (await execute(unknown)).json() == {"status": "unknown", "error": UNKNOWN}
        assert calls == ["Fixture prompt", "interrupted provider call"]
    await database.close()
