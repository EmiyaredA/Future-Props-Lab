"""Exercise a real owned Annotation source and WAV through Galgame preflight."""

import httpx
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_galgame_annotation_import import _audio_bytes, _import_body
from tests.test_independent_project_catalog import authorize

from fpl_annotation.application import create_app as create_annotation
from fpl_annotation.migrations.registry import MIGRATIONS as ANNOTATION_MIGRATIONS
from fpl_galgame.application import create_app as create_galgame
from fpl_galgame.migrations.registry import MIGRATIONS as GALGAME_MIGRATIONS
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply

PROJECTS = "/v1/galgame-workshop/projects"
ANNOTATION = "/v1/audio-annotation"


async def test_annotation_preview_checks_live_document_and_exact_original_wav(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    annotation_credential = "isolated-annotation-source-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        annotation=annotation_credential, galgame=CREDENTIALS["galgame"]
    )
    apps = {}
    for service, migrations, factory, credential in (
        ("annotation", ANNOTATION_MIGRATIONS, create_annotation, annotation_credential),
        ("galgame", GALGAME_MIGRATIONS, create_galgame, CREDENTIALS["galgame"]),
    ):
        root = tmp_path / service
        apply(root / "service.db", service, migrations)
        apps[service] = factory(
            state_root=root,
            public_key=case.key.public_key(),
            catalog=CATALOG,
            credential=credential,
            transport=case.mesh,
            run_worker=False,
        )
    case.mesh.apps.update(apps)
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    async with (
        live.client,
        apps["annotation"].router.lifespan_context(apps["annotation"]),
        apps["galgame"].router.lifespan_context(apps["galgame"]),
        httpx.AsyncClient(transport=case.mesh) as client,
    ):

        async def request(service, method, path, **kwargs):
            return await client.request(
                method,
                f"http://{service}" + path,
                headers=await authorize(case, service, method, path),
                **kwargs,
            )

        sound = _audio_bytes()
        source = await request(
            "assets",
            "POST",
            "/v1/files",
            files={"upload": ("annotation-source.wav", sound, "audio/wav")},
        )
        assert source.status_code == 200, source.text
        annotation = await request(
            "annotation",
            "POST",
            ANNOTATION + "/imports",
            json={
                "title": "Owned radio play",
                "asset_id": source.json()["id"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker", "name": "Speaker", "color": "#28B8A7"}],
                "segments": [
                    {
                        "id": f"segment-{index}",
                        "speaker_id": "speaker",
                        "start_ms": (index - 1) * 500,
                        "end_ms": index * 500,
                        "text": text,
                        "language": "zh",
                        "status": "reviewed",
                    }
                    for index, text in enumerate(("第一句", "第二句"), 1)
                ],
            },
        )
        assert annotation.status_code == 200, annotation.text
        project = await request("galgame", "POST", PROJECTS, json={"title": "Owned Galgame"})
        assert project.status_code == 200, project.text
        path = f"{PROJECTS}/{project.json()['id']}"
        master = await request(
            "galgame",
            "POST",
            path + "/assets",
            files={"upload": ("master.wav", sound, "audio/wav")},
            data={"category": "voice"},
        )
        assert master.status_code == 200, master.text
        story = (await request("galgame", "GET", path + "/story")).json()
        body = _import_body(story, annotation.json(), master.json(), sound)
        preview_path = path + "/annotation-imports/preview"
        preview = await request("galgame", "POST", preview_path, json=body)
        assert preview.status_code == 200 and preview.json()["ready"], preview.text
        assert preview.json()["sourceAssetId"] == source.json()["id"]
        assert preview.json()["masterAssetId"] == master.json()["id"]
        assert [item["text"] for item in preview.json()["segments"]] == ["第一句", "第二句"]
        changed = await request(
            "galgame",
            "POST",
            preview_path,
            json={**body, "expectedSourceRevision": body["expectedSourceRevision"] + 1},
        )
        assert changed.status_code == 200 and not changed.json()["ready"], changed.text
        assert {issue["code"] for issue in changed.json()["issues"]} == {"source_revision_conflict"}
        denied = await request(
            "galgame", "POST", preview_path, json={**body, "sourceProjectId": "missing"}
        )
        assert denied.status_code == 404
