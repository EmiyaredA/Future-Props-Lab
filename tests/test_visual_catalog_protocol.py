"""Keep Visual discovery credential-free and scoped to the live account."""

from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS, PROJECTS
from tests.test_independent_project_catalog import authorize

from app.llm.models import ModelEntry, ModelProvider
from fpl_models.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from fpl_models.models import ACCOUNT_MODELS, MODELS
from fpl_models.visual_catalog_http import router
from fpl_runtime.claims import HEADER
from fpl_runtime.database import Database
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.visual_catalog import (
    ACCEPTANCE_TARGET,
    GENERATION_SOURCE,
    GENERATION_TARGET,
    PURPOSE,
)


async def seed_catalog(database, owner, suffix):
    async with database.sessions(info={"owner_user_id": owner}) as db:
        for kind, slug, capabilities in (
            ("senseaudio_image", "senseaudio-image-2.0-260319", ["image_generation"]),
            ("openai", f"vision-{suffix}", ["chat", "vision"]),
            ("openai", f"text-{suffix}", ["chat"]),
        ):
            provider = ModelProvider(
                owner_user_id=owner,
                name=f"{kind}-{suffix}",
                kind=kind,
                base_url="https://models.example.test/v1",
                api_key_ciphertext="credential-stays-in-models",
            )
            db.add(provider)
            await db.flush()
            db.add(
                ModelEntry(
                    owner_user_id=owner,
                    provider_id=provider.id,
                    slug=slug,
                    capabilities=capabilities,
                )
            )
        await db.commit()


async def test_visual_catalog_delegates_exact_paths_and_excludes_other_accounts(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "visual"
    models_root = tmp_path / "models"
    factory, migrations, project_model, _ = PROJECTS["visual"]
    apply(root / "service.db", "visual", migrations)
    apply(models_root / "service.db", "models", MODELS_MIGRATIONS)
    credential = "visual-models-test-service-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        visual=CREDENTIALS["visual"], models=credential
    )
    models = FastAPI()
    database = Database("models", models_root, models=MODELS, account_models=ACCOUNT_MODELS)
    models.state.database = database
    models.state.identity_public_key = case.key.public_key()
    models.state.identity = LiveAuthorization(
        service="models", credential=credential, transport=case.mesh
    )
    models.state.settings = SimpleNamespace(fpl_temp_media_upload_url="")
    models.include_router(router)
    case.mesh.apps["models"] = models
    visual = factory(
        state_root=root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["visual"],
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["visual"] = visual
    for owner, label in ((case.viewer, "own"), (case.owner, "foreign")):
        await seed_catalog(database, owner, label)
        async with visual.state.database.sessions(info={"owner_user_id": owner}) as db:
            db.add(project_model(id=label, title=label, kind="canvas"))
            await db.commit()
    async with (
        models.state.identity.client,
        visual.router.lifespan_context(visual),
        httpx.AsyncClient(transport=case.mesh, base_url="http://visual") as http,
    ):
        options = await authorize(case, "visual", "GET", GENERATION_SOURCE)
        assert (await http.get(GENERATION_SOURCE)).status_code == 401
        response = await http.get(GENERATION_SOURCE, headers=options)
        assert response.status_code == 200, response.text
        available = response.json()["models"]
        assert len(available) == 1 and available[0]["provider_name"] == "senseaudio_image-own"
        assert available[0]["max_prompt_length"] == 6000
        path = "/v1/visual-workshop/projects/own/acceptance/models"
        response = await http.get(path, headers=await authorize(case, "visual", "GET", path))
        assert response.status_code == 200, response.text
        entries = response.json()["items"]
        assert len(entries) == 1 and entries[0]["slug"] == "vision-own"
        assert "credential" not in response.text and "base_url" not in response.text
        foreign = path.replace("/own/", "/foreign/")
        assert (
            await http.get(foreign, headers=await authorize(case, "visual", "GET", foreign))
        ).status_code == 404
        grant = RequestGrant(
            "visual", PURPOSE, "GET", GENERATION_SOURCE, "models", "GET", GENERATION_TARGET
        )
        token = await visual.state.capabilities.authorize_request(options[HEADER], grant)
        private = "http://models:8080"
        assert (await http.get(private + GENERATION_TARGET, headers=options)).status_code == 401
        assert (
            await http.get(private + ACCEPTANCE_TARGET, headers={HEADER: token})
        ).status_code == 401
        assert (
            await http.get(
                private + GENERATION_TARGET,
                headers={HEADER: token, "Origin": "https://browser.test"},
            )
        ).status_code == 403
        logged_out = await case.browser.post(
            "/v1/auth/logout",
            headers={"Origin": "http://127.0.0.1:19000", "X-CSRF-Token": case.csrf},
        )
        assert logged_out.status_code == 204, logged_out.text
        assert (
            await http.get(private + GENERATION_TARGET, headers={HEADER: token})
        ).status_code == 401
    await database.close()
