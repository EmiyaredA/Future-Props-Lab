"""Run node acceptance across the native owner boundary and recover lost receipts."""

import subprocess
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize
from tests.test_visual_acceptance import submission
from tests.test_visual_catalog_protocol import seed_catalog
from tests.test_visual_compositions_service import Faults, png

from app.llm.models import ModelEntry
from app.llm.visual_review import Suggestions
from fpl_models.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from fpl_models.models import ACCOUNT_MODELS, MODELS
from fpl_models.visual_catalog_http import router as models_catalog
from fpl_models.visual_review_attempts import VisualReviewAttempts
from fpl_models.visual_review_http import router as model_reviews
from fpl_rendering.application import create_app as create_rendering
from fpl_rendering.migrations.registry import MIGRATIONS as RENDERING_MIGRATIONS
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityClient, CapabilityUnavailable
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.visual_review import MODEL_RUN
from fpl_visual.application import create_app as create_visual
from fpl_visual.migrations.registry import MIGRATIONS as VISUAL_MIGRATIONS


class ReviewFaults(Faults):
    drop_model = False

    async def handle_async_request(self, request):
        response = await super().handle_async_request(request)
        if (
            self.drop_model
            and request.url.host == "models"
            and request.url.path.startswith(MODEL_RUN)
        ):
            assert response.status_code == 200
            self.drop_model = False
            await response.aclose()
            raise httpx.ReadError("lost fixed model result", request=request)
        return response


@asynccontextmanager
async def review_mesh(case, tmp_path):
    credentials = {
        "visual": CREDENTIALS["visual"],
        "models": "isolated-node-review-models-credential-" * 2,
        "rendering": "isolated-node-review-rendering-credential-" * 2,
        "assets": ASSETS_SECRET,
    }
    case.identity.state.identity_options["service_credentials"].update(credentials)
    for name, migrations in (
        ("models", MODELS_MIGRATIONS),
        ("rendering", RENDERING_MIGRATIONS),
        ("visual", VISUAL_MIGRATIONS),
    ):
        apply(tmp_path / name / "service.db", name, migrations)

    def peer(name):
        return CapabilityClient(
            service=name, credential=credentials[name], catalog=CATALOG, transport=case.mesh
        )

    def live(name):
        return LiveAuthorization(service=name, credential=credentials[name], transport=case.mesh)

    root = tmp_path / "models"
    database = Database("models", root, models=MODELS, account_models=ACCOUNT_MODELS)
    await seed_catalog(database, case.viewer, "review")
    async with database.sessions(info={"owner_user_id": case.viewer}) as db:
        model_id = await db.scalar(select(ModelEntry.id).where(ModelEntry.slug == "vision-review"))
    models = FastAPI()
    models.state.database = database
    models.state.identity_public_key = case.key.public_key()
    models.state.identity = live("models")
    models.state.settings = SimpleNamespace(
        fpl_acceptance_model_owner_user_id=case.viewer, fpl_acceptance_model_id=model_id
    )
    models.state.visual_review_attempts = VisualReviewAttempts(models.state)
    models.include_router(models_catalog)
    models.include_router(model_reviews)
    rendering = create_rendering(
        settings=RenderingSettings(tmp_path / "rendering" / "service.db"),
        public_key=case.key.public_key(),
        catalog=CATALOG,
        identity=live("rendering"),
        capabilities=peer("rendering"),
        run_worker=False,
    )
    case.mesh.apps.update(models=models, rendering=rendering)
    case.assets.state.identity = live("assets")
    case.assets.state.capabilities = peer("assets")
    transport = ReviewFaults(case.mesh)

    @asynccontextmanager
    async def visual():
        app = create_visual(
            state_root=tmp_path / "visual",
            public_key=case.key.public_key(),
            catalog=CATALOG,
            credential=credentials["visual"],
            transport=transport,
            run_worker=False,
        )
        case.mesh.apps["visual"] = app
        async with app.router.lifespan_context(app):
            yield app

    try:
        async with (
            models.state.identity.client,
            case.assets.state.identity.client,
            case.assets.state.capabilities.client,
            rendering.router.lifespan_context(rendering),
            httpx.AsyncClient(transport=case.mesh) as http,
        ):

            async def send(method, path, *, service="visual", **kwargs):
                return await http.request(
                    method,
                    f"http://{service}" + path,
                    headers=await authorize(case, service, method, path),
                    **kwargs,
                )

            yield visual, send, transport
    finally:
        await database.close()


def video_file(tmp_path):
    path = tmp_path / "review.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=red:s=96x64:r=8:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=20,
    )
    return path.read_bytes()


async def create_run(send, app, video):
    project = await send(
        "POST", "/v1/visual-workshop/projects", json={"title": "Fixed vision", "kind": "canvas"}
    )
    assert project.status_code == 200, project.text
    identity = project.json()["id"]
    await app.state.reference_delivery.process_once()

    async def upload(name, data, mime):
        result = await send(
            "POST",
            "/v1/files",
            service="assets",
            data={"project_id": identity},
            files={"upload": (name, data, mime)},
        )
        assert result.status_code == 200, result.text
        return result.json()["id"]

    image = await upload("character.png", png("blue"), "image/png")
    reference = await upload("reference.mp4", video, "video/mp4")
    output = await upload("output.mp4", video, "video/mp4")
    root = f"/v1/visual-workshop/projects/{identity}"
    saved = await send(
        "PUT",
        root + "/canvas",
        json={
            "expected_revision": 0,
            "nodes": [
                {
                    "id": "shot",
                    "title": "Review",
                    "kind": "video",
                    "position": {"x": 0, "y": 0},
                    "generation_draft": {
                        "prompt": "Frozen source",
                        "mode": "reference",
                        "ratio": "adaptive",
                        "duration": -1,
                        "reference_asset_ids": [image],
                        "video_asset_ids": [reference],
                    },
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    node = root + "/nodes/shot"
    saved = await send("POST", node + "/outputs", json={"expected_revision": 1, "asset_id": output})
    assert saved.status_code == 200, saved.text
    await app.state.reference_delivery.process_once()
    selected = await send(
        "PUT",
        node + "/acceptance",
        json={"expected_revision": 0, "scheme_id": "motion-transfer:api"},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["issues"] == []
    launch = node + "/acceptance/runs"
    body = submission(selected.json())
    stale = await send("POST", launch, json={**body, "expected_canvas_revision": 0})
    assert stale.status_code == 409, stale.text
    launched = await send("POST", launch, json=body)
    assert launched.status_code == 200, launched.text
    queued = launched.json()
    assert queued["status"] == "queued" and queued["revision"] == 0
    duplicate = await send("POST", launch, json=body)
    assert duplicate.json() == queued
    conflict = await send("POST", launch, json={**body, "output_id": "different"})
    assert conflict.status_code == 409
    return root + "/acceptance/runs/" + queued["id"], queued["id"], {image, reference, output}


async def test_node_review_restarts_after_lost_evidence_and_model_receipts(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    calls = []

    async def evaluate(_args, payload, images, usage, _transport):
        assert payload["prompt"] == "Frozen source"
        assert len(payload["evidence"]) == len(images)
        assert {item["source_asset_id"] for item in payload["evidence"]} == sources
        calls.append(payload)
        usage["prompt_tokens"] = 19
        return Suggestions.model_validate(
            {
                "results": [
                    {
                        "criterion_id": item["id"],
                        "verdict": "passed",
                        "explanation": "Verified",
                        "evidence_ids": [payload["evidence"][0]["id"]],
                    }
                    for item in payload["criteria"]
                ]
            }
        )

    monkeypatch.setattr("fpl_models.visual_review_attempts.decrypt_secret", lambda _: "test-key")
    monkeypatch.setattr("fpl_models.visual_review_attempts.evaluate_review", evaluate)
    async with review_mesh(scenario, tmp_path) as (visual, send, faults):
        async with visual() as app:
            path, identity, sources = await create_run(send, app, video_file(tmp_path))
            await app.state.reference_delivery.process_once()
            faults.drop_commit = True
            with pytest.raises(CapabilityUnavailable):
                await app.state.review_runner.run(scenario.viewer, identity)
            assert not faults.drop_commit
            first = (await send("GET", path)).json()
            assert first["status"] == "processing" and first["evidence"]
            assert not calls
        async with visual() as app:
            faults.drop_model = True
            with pytest.raises(CapabilityUnavailable):
                await app.state.review_runner.run(scenario.viewer, identity)
            assert not faults.drop_model and len(calls) == 1
            saved = (await send("GET", path)).json()
            assert saved["evidence"][: len(first["evidence"])] == first["evidence"]
        async with visual() as app:
            await app.state.review_runner.run(scenario.viewer, identity)
            done = (await send("GET", path)).json()
            assert done["status"] == "completed", done
            assert done["evidence"] == saved["evidence"]
            assert done["execution_result"]["usage"] == {"prompt_tokens": 19}
            assert done["results"][0]["verdict"] == "passed"
            assert all(
                row["suggestion"] == "passed" for row in done["results"] if row["origin"] == "ai"
            )
            assert len(calls) == 1

            root = path.split("/acceptance/runs/")[0]
            launch = root + "/nodes/shot/acceptance/runs"
            context = await send("GET", root + "/nodes/shot/acceptance")
            queued = await send("POST", launch, json=submission(context.json(), "cancelled"))
            assert queued.status_code == 200, queued.text
            cancelled = queued.json()
            cancel_path = root + "/acceptance/runs/" + cancelled["id"] + "/cancel"
            reply = await send(
                "POST", cancel_path, params={"expected_revision": cancelled["revision"]}
            )
            assert reply.status_code == 200 and reply.json()["status"] == "cancelled", reply.text
            await app.state.review_runner.run(scenario.viewer, cancelled["id"])
            assert len(calls) == 1
