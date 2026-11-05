"""Check Galgame's settings and history without importing Models storage."""

import httpx
from fastapi import FastAPI
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS, PROJECTS
from tests.test_independent_project_catalog import authorize

from studio.apps.galgame_workshop.storage.models import GalgameAssetTranscriptionTask
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.model_service.transport.galgame_asr_http import router
from studio.contracts.galgame_workshop.galgame_snapshot import (
    IMPORT,
    MODEL_PURPOSE,
    MODEL_REFERENCE_PREFIX,
    MODEL_RESOLVE_PREFIX,
    ModelReference,
)
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


async def seed_transcription_model(database, owner, name):
    async with database.sessions(info={"owner_user_id": owner}) as db:
        provider = ModelProvider(
            owner_user_id=owner,
            name=name,
            kind="openai",
            base_url="https://models.example.test/v1",
        )
        db.add(provider)
        await db.flush()
        model = ModelEntry(
            owner_user_id=owner,
            provider_id=provider.id,
            slug="isolated-asr",
            capabilities=["speech_recognition"],
        )
        db.add(model)
        await db.commit()
        return model.id


async def test_galgame_asr_settings_check_the_owned_catalog_and_keep_task_history(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    roots = {service: tmp_path / service for service in ("galgame", "models")}
    factory, migrations, project_model, _ = PROJECTS["galgame"]
    apply(roots["galgame"] / "service.db", "galgame", migrations)
    apply(roots["models"] / "service.db", "models", MODELS_MIGRATIONS)
    credential = "galgame-asr-models-test-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        galgame=CREDENTIALS["galgame"], models=credential
    )
    models = FastAPI()
    model_db = Database("models", roots["models"], models=MODELS, account_models=ACCOUNT_MODELS)
    models.state.database = model_db
    models.state.identity_public_key = case.key.public_key()
    models.state.identity = LiveAuthorization(
        service="models", credential=credential, transport=case.mesh
    )
    models.include_router(router)
    case.mesh.apps["models"] = models
    own = await seed_transcription_model(model_db, case.viewer, "Own provider")
    foreign = await seed_transcription_model(model_db, case.owner, "Foreign provider")
    galgame = factory(
        state_root=roots["galgame"],
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["galgame"] = galgame
    for owner, project in ((case.viewer, "owned"), (case.owner, "foreign")):
        async with galgame.state.database.sessions(info={"owner_user_id": owner}) as db:
            db.add(project_model(id=project, title=project))
            await db.flush()
            db.add(
                GalgameAssetTranscriptionTask(
                    id=project,
                    project_id=project,
                    asset_id=project + "-audio",
                    status="completed",
                    provider_name="Preserved provider",
                    model_slug="legacy-model",
                    result_text=project + " transcription",
                )
            )
            await db.commit()
    root = "/v1/galgame-workshop/projects/owned/assets/asr"
    path = root + "/settings"
    async with (
        models.state.identity.client,
        galgame.router.lifespan_context(galgame),
        httpx.AsyncClient(transport=case.mesh, base_url="http://galgame") as http,
    ):

        async def call(method, target, **kwargs):
            headers = await authorize(case, "galgame", method, target)
            return await http.request(method, target, headers=headers, **kwargs)

        default = await call("GET", path)
        assert default.status_code == 200, default.text
        assert default.json()["revision"] == 0 and not default.json()["modelReady"]
        rejected = await call("PATCH", path, json={"expectedRevision": 0, "modelId": foreign})
        assert rejected.status_code == 422 and rejected.json()["code"] == "asr_model_unavailable"
        updated = await call(
            "PATCH", path, json={"expectedRevision": 0, "modelId": own, "concurrency": 3}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 1 and updated.json()["modelReady"]
        assert updated.json()["modelId"] == own
        stale = await call("PATCH", path, json={"expectedRevision": 0, "concurrency": 4})
        assert stale.status_code == 409 and stale.json()["current"] == updated.json()
        assert (await call("GET", path)).json() == updated.json()
        denied = await call("GET", path.replace("/owned/", "/foreign/"))
        assert denied.status_code == 404
        records = await call("GET", root + "/transcriptions")
        assert records.status_code == 200, records.text
        assert [item["resultText"] for item in records.json()["items"]] == ["owned transcription"]
        snapshot = root.removesuffix("/assets/asr") + "/snapshot"
        original = (await authorize(case, "galgame", "GET", snapshot))[HEADER]
        for model, expected in (
            (own, {"provider_kind": "openai", "model_slug": "isolated-asr"}),
            (foreign, None),
        ):
            target = f"{MODEL_REFERENCE_PREFIX}/{model}"
            grant = RequestGrant("galgame", MODEL_PURPOSE, "GET", snapshot, "models", "GET", target)
            token = await galgame.state.capabilities.authorize_request(original, grant)
            reference = await http.get("http://models" + target, headers={HEADER: token})
            assert reference.status_code == 200 and reference.json() == expected, reference.text
        import_token = (await authorize(case, "galgame", "POST", IMPORT))[HEADER]
        for slug, expected in (("isolated-asr", own), ("missing-asr", None)):
            model = ModelReference(provider_kind="openai", model_slug=slug)
            target = f"{MODEL_RESOLVE_PREFIX}/{model.digest}"
            grant = RequestGrant("galgame", MODEL_PURPOSE, "POST", IMPORT, "models", "POST", target)
            token = await galgame.state.capabilities.authorize_request(import_token, grant)
            resolved = await http.post(
                "http://models" + target, headers={HEADER: token}, json=model.model_dump()
            )
            assert resolved.status_code == 200 and resolved.json() == expected, resolved.text
            changed = await http.post(
                "http://models" + target,
                headers={HEADER: token},
                json={**model.model_dump(), "model_slug": "tampered"},
            )
            assert changed.status_code == 403
        cleared = await call("PATCH", path, json={"expectedRevision": 1, "modelId": None})
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["modelId"] is None and not cleared.json()["modelReady"]
    await model_db.close()
