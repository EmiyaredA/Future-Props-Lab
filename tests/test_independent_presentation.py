"""Exercise Presentation documents and reference delivery through owned services."""

import io
import zipfile
from pathlib import Path

import httpx
import pytest
from starlette.datastructures import Headers, UploadFile
from tests.presentation_helpers import element, sample_document
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.test_independent_project_catalog import authorize

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.presentation_workshop.projects import Presentations
from studio.apps.presentation_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.presentation_workshop.templates.schema import TemplateDefinition
from studio.assembly.independent.presentation_workshop.application import create_app
from studio.contracts.presentation_workshop.presentation_archives import DOMAIN, IMPORT
from studio.contracts.presentation_workshop.presentation_assets import BUNDLE, LIBRARY, PROJECTS
from studio.contracts.thought_workshop.thought_archives import ArchiveAuthenticator
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityUnavailable

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "presentation-identity-fixture-secret-unique"
ARCHIVE_KEY = "presentation-archive-fixture-secret-unique"
SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">'
    b'<rect width="20" height="20" fill="#111111"/></svg>'
)


async def test_projects_hold_exact_account_asset_references_and_replay(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    state = tmp_path / "presentation"
    apply(state / "service.db", "presentation", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["presentation"] = TOKEN
    case.assets.state.presentation_archive_auth = ArchiveAuthenticator(ARCHIVE_KEY, domain=DOMAIN)
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        uploaded = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(
                io.BytesIO(SVG),
                filename="mark.svg",
                headers=Headers({"Content-Type": "image/svg+xml"}),
            ),
            owner_user_id=case.viewer,
        )
        asset = uploaded.id
    document = sample_document().model_dump(mode="json")
    document["slides"][0]["elements"].append(
        element("vector", id="vector-one", asset_id=asset, vector_color="#441188")
    )

    def application():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential=TOKEN,
            archive_key=ARCHIVE_KEY,
            schema_path=ROOT / "web/src/generated/openapi.json",
            transport=case.mesh,
            run_worker=False,
        )

    async def call(client, method, path, **kwargs):
        headers = await authorize(case, "presentation", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    def live():
        case.assets.state.identity = LiveAuthorization(
            service="assets", credential=ASSETS_SECRET, transport=case.mesh
        )
        return case.assets.state.identity.client

    async def delete_file(identity=asset):
        path = f"/v1/files/{identity}"
        headers = await authorize(case, "assets", "DELETE", path)
        async with httpx.AsyncClient(
            base_url="http://assets", transport=httpx.ASGITransport(app=case.assets)
        ) as client:
            return await client.delete(path, headers=headers, params={"expected_revision": 0})

    create = {"title": "Independent presentation", "document": document}
    app = application()
    async with (
        live(),
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            base_url="http://presentation", transport=httpx.ASGITransport(app=app)
        ) as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(api, "POST", PROJECTS, json=create)
        assert created.status_code == 200, created.text
        row = created.json()
        project = f"{PROJECTS}/{row['id']}"
        assert (await call(api, "GET", PROJECTS)).json()["items"][0]["id"] == row["id"]
        assert (await delete_file()).status_code == 409
        await app.state.reference_delivery.process_once()
        assert (await delete_file()).status_code == 409
        body = {"title": "Renamed", "expected_revision": 0, "document": row["document"]}
        saved = await call(api, "PUT", project, json=body)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert (await call(api, "PUT", project, json=body)).status_code == 409

        commit = app.state.retention_client.commit

        async def lost_commit_reply(**request):
            await commit(**request)
            raise CapabilityUnavailable("simulated lost commit reply")

        with monkeypatch.context() as fault:
            fault.setattr(app.state.retention_client, "commit", lost_commit_reply)
            with pytest.raises(CapabilityUnavailable, match="lost commit"):
                await app.state.reference_delivery.process_once()

    restarted = application()
    async with (
        live(),
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            base_url="http://presentation", transport=httpx.ASGITransport(app=restarted)
        ) as api,
    ):
        assert (await call(api, "GET", project)).json() == saved.json()
        await restarted.state.reference_delivery.process_once()
        assert (await delete_file()).status_code == 409
        body = {
            "request_id": "independent-presentation-ops",
            "expected_revision": 1,
            "operations": [
                {
                    "entity": "element",
                    "action": "update",
                    "id": "vector-one",
                    "parent_id": "slide-one",
                    "value": {"x": 42},
                }
            ],
        }
        applied = await call(api, "POST", project + "/operations", json=body)
        assert applied.status_code == 200, applied.text
        repeated = await call(api, "POST", project + "/operations", json=body)
        assert repeated.json() == applied.json()
        assert applied.json()["revision"] == 2
        package = await check_exports(api, call, project, applied.json(), asset)
        await check_archive_import(api, call, restarted, delete_file, package, asset, monkeypatch)
        assert list((state / ".staging").iterdir()) == []
        await restarted.state.reference_delivery.process_once()
        removed = await call(api, "DELETE", project, params={"expected_revision": 2})
        assert removed.status_code == 200, removed.text
        await restarted.state.reference_delivery.process_once()
        assert (await call(api, "GET", project)).status_code == 404

        await check_template_bundle(api, call, restarted, delete_file, asset, monkeypatch)

        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "POST", PROJECTS, json=create)).status_code == 404
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "viewing-user", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        case.csrf = case.browser.cookies["fpl_csrf"]
        deleted = await delete_file()
        assert deleted.status_code == 200, deleted.text


async def check_template_bundle(api, call, app, delete_file, asset, monkeypatch):
    definition = TemplateDefinition().model_dump()
    definition["fixed"] = [
        {
            "id": "logo",
            "kind": "image",
            "asset_id": asset,
            "x": 1100,
            "y": 32,
            "width": 116,
            "height": 40,
        }
    ]
    template_body = {"title": "Scoped template", "definition": definition}
    example_doc = sample_document().model_dump(mode="json")
    bundle = {
        "template": template_body,
        "example": {"title": "Scoped example", "document": example_doc},
    }
    imported = await call(api, "POST", BUNDLE, json=bundle)
    assert imported.status_code == 200, imported.text
    template, example = imported.json()["template"], imported.json()["example"]
    assert example["document"]["template"]["template_id"] == template["id"]
    templates, examples = LIBRARY["template"], LIBRARY["example"]
    template_url, example_url = f"{templates}/{template['id']}", f"{examples}/{example['id']}"
    project_reply = await call(
        api,
        "POST",
        template_url + "/documents",
        json={"title": "From a retained template", "expected_revision": 0},
    )
    assert project_reply.status_code == 200, project_reply.text
    project_url = f"{PROJECTS}/{project_reply.json()['id']}"
    await app.state.reference_delivery.process_once()
    assert (await delete_file()).status_code == 409

    change = {
        "expected_revision": 0,
        "template_id": template["id"],
        "template_revision": 0,
        "action": "update",
    }
    preview_url, apply_url = project_url + "/template/preview", project_url + "/template/apply"
    preview = await call(api, "POST", preview_url, json=change)
    assert preview.status_code == 200, preview.text
    prepare = Presentations._prepare

    async def bump_after_prepare(projects, *args):
        prepared = await prepare(projects, *args)
        bumped = await call(
            api,
            "PUT",
            template_url,
            json={**template_body, "title": "New template revision", "expected_revision": 0},
        )
        assert bumped.status_code == 200, bumped.text
        return prepared

    with monkeypatch.context() as fault:
        fault.setattr(Presentations, "_prepare", bump_after_prepare)
        conflicted = await call(
            api,
            "POST",
            apply_url,
            json={**change, "preview_token": preview.json()["preview_token"]},
        )
    assert conflicted.status_code == 409, conflicted.text
    assert (await call(api, "GET", project_url)).json() == project_reply.json()
    change["template_revision"] = 1
    preview = await call(api, "POST", preview_url, json=change)
    assert preview.status_code == 200, preview.text
    applied = await call(
        api, "POST", apply_url, json={**change, "preview_token": preview.json()["preview_token"]}
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["document"]["template"]["template_revision"] == 1

    for path, revision in [(template_url, 1), (example_url, 0), (project_url, 1)]:
        result = await call(api, "DELETE", path, params={"expected_revision": revision})
        assert result.status_code == 200, result.text
    await app.state.reference_delivery.process_once()

    example_doc["slides"][0]["elements"].append(
        element("image", id="missing-image", asset_id="missing")
    )
    failed = await call(api, "POST", BUNDLE, json=bundle)
    assert failed.status_code == 404, failed.text
    assert (await call(api, "GET", templates)).json()["total"] == 0
    assert (await call(api, "GET", examples)).json()["total"] == 0
    assert (await delete_file()).status_code == 409
    await app.state.reference_delivery.process_once()


async def check_exports(api, call, project, snapshot, asset):
    revision = {"expected_revision": snapshot["revision"]}
    prefix = project + "/export"
    assert (await call(api, "POST", prefix, json={"expected_revision": 0})).status_code == 409
    preview = await call(api, "POST", prefix + "/preview", json=revision)
    assert preview.status_code == 200 and preview.json()["revision"] == snapshot["revision"]
    raw = await call(api, "POST", prefix + "/json", json=revision)
    assert raw.status_code == 200, raw.text
    assert raw.json()["document"] == snapshot["document"]
    package = await call(api, "POST", prefix + "/fplppt", json=revision)
    assert package.status_code == 200, package.text
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        from studio.runtime.files.svg import normalize_svg

        assert archive.read("assets/" + asset) == normalize_svg(SVG.decode())["svg"].encode()
    pptx = await call(api, "POST", prefix, json=revision)
    assert pptx.status_code == 200, pptx.text
    with zipfile.ZipFile(io.BytesIO(pptx.content)) as archive:
        assert "ppt/slides/slide1.xml" in archive.namelist()
        assert any(path.startswith("ppt/media/") for path in archive.namelist())
    return package.content


async def check_archive_import(api, call, app, delete_file, package, original, monkeypatch):
    file = {"upload": ("fixture.fplppt", package, "application/zip")}
    preview = await call(api, "POST", IMPORT + "/preview", files=file)
    assert preview.status_code == 200, preview.text
    assert preview.json()["preview_assets"][original].startswith("data:image/svg+xml;base64,")

    transport = app.state.import_delivery.transport
    settle = transport.settle

    async def lost_published_receipt(outcome):
        await settle(outcome)
        raise CapabilityUnavailable("simulated lost archive receipt")

    with monkeypatch.context() as fault:
        fault.setattr(transport, "settle", lost_published_receipt)
        pending = await call(api, "POST", IMPORT, files=file)
    assert pending.status_code == 503, pending.text
    assert pending.json()["code"] == "archive_pending"
    assert (await call(api, "GET", PROJECTS)).json()["total"] == 1

    retry = await call(api, "POST", IMPORT, files=file)
    assert retry.status_code == 200, retry.text
    assert (await call(api, "GET", PROJECTS)).json()["total"] == 2
    result = retry.json()
    copied = next(
        element["asset_id"]
        for element in result["document"]["slides"][0]["elements"]
        if element["kind"] == "vector"
    )
    assert copied != original
    await app.state.import_delivery.process_once()
    assert (await delete_file(copied)).status_code == 409
    removed = await call(
        api, "DELETE", f"{PROJECTS}/{result['id']}", params={"expected_revision": 0}
    )
    assert removed.status_code == 200, removed.text
    await app.state.reference_delivery.process_once()
    assert (await delete_file(copied)).status_code == 200
