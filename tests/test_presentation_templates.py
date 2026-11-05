"""Template contracts and library journeys against isolated test storage."""

import copy
import io
import json
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from pptx import Presentation
from tests.presentation_helpers import sample_document
from tests.test_presentation_image_version import delete_asset, upload

from app.main import app
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.templates.resolver import materialize, resolve_document
from studio.apps.presentation_workshop.templates.schema import TemplateDefinition

ROOT = "/v1/presentation-workshop"
FIXTURE = Path(__file__).parent / "fixtures/presentation_template_cases.json"


@pytest_asyncio.fixture(autouse=True)
async def clean_template_resources(request):
    if request.node.get_closest_marker("asyncio") is None or request.node.get_closest_marker(
        "real_auth"
    ):
        yield
        return
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:

        async def inventory(kind):
            return {
                item["id"]: item
                for item in (await client.get(ROOT + "/" + kind, params={"limit": 100})).json()[
                    "items"
                ]
            }

        before = {kind: await inventory(kind) for kind in ("projects", "templates", "examples")}
        files = {
            item["id"]
            for item in (await client.get("/v1/files", params={"include_svg": True})).json()[
                "items"
            ]
        }
        yield
        for kind in ("projects", "examples", "templates"):
            for identity, item in (await inventory(kind)).items():
                if identity not in before[kind]:
                    response = await client.delete(
                        ROOT + "/" + kind + "/" + identity,
                        params={"expected_revision": item["revision"]},
                    )
                    assert response.status_code == 200, response.text
        for item in (await client.get("/v1/files", params={"include_svg": True})).json()["items"]:
            if item["id"] not in files:
                response = await delete_asset(client, item)
                assert response.status_code == 200, response.text


def test_shared_master_fixtures():
    for case in json.loads(FIXTURE.read_text()):
        source = PresentationDocument.model_validate(case["document"])
        before = source.model_dump()
        result, issues = resolve_document(source)
        assert [
            [
                "".join(r.text for p in e.paragraphs for r in p.runs)
                for e in s.elements
                if e.id.startswith("master-")
            ]
            for s in result.slides
        ] == case["texts"]
        assert [i["code"] for i in issues] == case["issues"]
        assert source.model_dump() == before
        assert result.template is None
        assert result.slides[0].notes == source.slides[0].notes
        assert len({e.id for s in result.slides for e in s.elements}) == sum(
            len(s.elements) for s in result.slides
        )
        assert all(
            e.locked for s in result.slides for e in s.elements if e.id.startswith("master-")
        )


def test_toc_continuations_rename_reorder_and_materialize():
    document = PresentationDocument.model_validate(json.loads(FIXTURE.read_text())[0]["document"])
    document.template.snapshot.layouts["toc"].toc_capacity = 1
    document.slides[0].page_type = "toc"
    document.slides[0].toc_offset = 0
    document.slides[1].page_type = "toc"
    document.slides[1].toc_offset = 1
    document.chapters[0].title = "改名章节"
    resolved, issues = resolve_document(document)
    assert not any(i["code"] == "toc_overflow" for i in issues)
    assert any(
        "改名章节" in r.text
        for e in resolved.slides[0].elements
        for p in e.paragraphs
        for r in p.runs
    )
    document.slides.reverse()
    resolved, _ = resolve_document(document)
    assert any(
        "第二章    10" == r.text
        for s in resolved.slides
        for e in s.elements
        for p in e.paragraphs
        for r in p.runs
    )
    detached = materialize(document)
    assert detached.template is None
    assert all(
        not e.locked
        for s in detached.slides
        for e in s.elements
        if e.id.startswith("native-master-")
    )
    assert detached.chapters == document.chapters
    assert detached.slides[0].notes == document.slides[0].notes


@pytest.mark.asyncio
async def test_template_library_bind_update_conflicts_downgrade_export_and_examples():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        definition = TemplateDefinition().model_dump()
        body = {"title": "技术模板", "definition": definition}
        template = (await client.post(ROOT + "/templates", json=body)).json()
        assert template["revision"] == 0
        template_url = ROOT + "/templates/" + template["id"]
        assert (await client.put(template_url, json=body)).status_code == 422
        project = (
            await client.post(
                ROOT + "/projects",
                json={"title": "绑定验证", "document": sample_document().model_dump()},
            )
        ).json()
        url = ROOT + "/projects/" + project["id"]
        change = {
            "expected_revision": 0,
            "template_id": template["id"],
            "template_revision": 0,
            "chapters": [{"id": "chapter", "title": "实现"}],
            "mappings": [
                {
                    "slide_id": s["id"],
                    "title": "页标题 " + str(i),
                    "page_type": "cover" if i == 0 else "content",
                    "chapter_id": "chapter",
                    "title_element_ids": [e["id"] for e in s["elements"] if e["kind"] == "text"],
                }
                for i, s in enumerate(project["document"]["slides"])
            ],
        }
        no_mapping = await client.post(url + "/template/preview", json={**change, "mappings": []})
        assert no_mapping.status_code == 422
        preview = await client.post(url + "/template/preview", json=change)
        assert preview.status_code == 200, preview.text
        preview = preview.json()
        assert len(preview["affected_slides"]) == 3
        assert (await client.get(url)).json() == project
        applied = await client.post(
            url + "/template/apply", json={**change, "preview_token": preview["preview_token"]}
        )
        assert applied.status_code == 200, applied.text
        project = applied.json()
        assert project["document"]["version"] == 4
        assert project["document"]["slides"][1]["notes"] == "旋转形状"
        assert project["document"]["slides"][1]["elements"][0]["kind"] == "rect"
        assert (
            await client.post(
                url + "/template/apply", json={**change, "preview_token": preview["preview_token"]}
            )
        ).status_code == 409
        legacy = sample_document().model_dump()
        assert (
            await client.put(url, json={"title": "old", "document": legacy, "expected_revision": 1})
        ).status_code == 422
        listed = (await client.get(ROOT + "/projects", params={"query": "绑定验证"})).json()
        assert any(
            e["id"].startswith("master-") for e in listed["items"][0]["first_slide"]["elements"]
        )
        # Preview pins both target and document revisions.
        update_request = {
            "expected_revision": 1,
            "template_id": template["id"],
            "template_revision": 0,
            "action": "update",
        }
        stale = (await client.post(url + "/template/preview", json=update_request)).json()
        definition["layouts"]["content"]["title"]["style"]["size"] = 48
        changed_template = await client.put(
            template_url,
            json={"title": "技术模板", "definition": definition, "expected_revision": 0},
        )
        assert changed_template.status_code == 200, changed_template.text
        assert (
            await client.post(
                url + "/template/apply",
                json={**update_request, "preview_token": stale["preview_token"]},
            )
        ).status_code == 409
        assert (
            await client.put(template_url, json={**body, "expected_revision": 0})
        ).status_code == 409
        update_request["template_revision"] = 1
        fresh = (await client.post(url + "/template/preview", json=update_request)).json()
        assert len(fresh["affected_slides"]) == 2
        applied = await client.post(
            url + "/template/apply",
            json={**update_request, "preview_token": fresh["preview_token"]},
        )
        assert applied.status_code == 200, applied.text
        project = applied.json()
        exported = await client.post(url + "/export", json={"expected_revision": 2})
        assert exported.status_code == 200, exported.text
        pptx = Presentation(io.BytesIO(exported.content))
        assert "页标题 0" in [s.text for s in pptx.slides[0].shapes if s.has_text_frame]
        assert "1" not in [s.text for s in pptx.slides[0].shapes if s.has_text_frame]
        title = next(s for s in pptx.slides[1].shapes if s.has_text_frame and s.text == "页标题 1")
        assert title.text_frame.paragraphs[0].runs[0].font.size is not None
        example = (
            await client.post(
                ROOT + "/examples", json={"title": "完成示例", "document": project["document"]}
            )
        ).json()
        copied = await client.post(
            ROOT + "/examples/" + example["id"] + "/documents",
            json={"title": "示例副本", "expected_revision": 0},
        )
        assert copied.status_code == 200, copied.text
        assert copied.json()["document"] == project["document"]
        assert copied.json()["id"] != project["id"]
        # Removing the library resource cannot invalidate a pinned snapshot.
        assert (
            await client.delete(template_url, params={"expected_revision": 1})
        ).status_code == 200
        assert (
            await client.post(url + "/export", json={"expected_revision": 2})
        ).status_code == 200
        request = {"action": "unbind", "expected_revision": 2}
        preview = (await client.post(url + "/template/preview", json=request)).json()
        result = await client.post(
            url + "/template/apply", json={**request, "preview_token": preview["preview_token"]}
        )
        assert result.status_code == 200, result.text
        assert result.json()["document"]["template"] is None
        assert any(
            e["id"].startswith("native-master-")
            for e in result.json()["document"]["slides"][0]["elements"]
        )


@pytest.mark.asyncio
async def test_template_asset_protection_package_roundtrip_and_atomic_bundle():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        logo = await upload(client, "logo.png")
        definition = TemplateDefinition().model_dump()
        definition["fixed"] = [
            {
                "id": "logo",
                "kind": "image",
                "asset_id": logo["id"],
                "x": 1100,
                "y": 32,
                "width": 116,
                "height": 40,
            }
        ]
        example_doc = sample_document().model_dump()
        bundle = await client.post(
            ROOT + "/library/import",
            json={
                "template": {"title": "Logo 模板", "definition": definition},
                "example": {"title": "Logo 示例", "document": example_doc},
            },
        )
        assert bundle.status_code == 200, bundle.text
        template, example = bundle.json()["template"], bundle.json()["example"]
        assert example["document"]["template"]["template_id"] == template["id"]
        assert (await delete_asset(client, logo)).status_code == 409
        created = await client.post(
            ROOT + "/templates/" + template["id"] + "/documents",
            json={"title": "Logo 文稿", "expected_revision": 0},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = ROOT + "/projects/" + project["id"]
        package = await client.post(url + "/export/fplppt", json={"expected_revision": 0})
        assert package.status_code == 200, package.text
        imported = await client.post(
            ROOT + "/imports",
            files={"upload": ("test.fplppt", package.content, "application/zip")},
            data={"allow_lossy": "true"},
        )
        assert imported.status_code == 200, imported.text
        document = imported.json()["document"]
        assert document["template"]["template_id"] is None
        assert document["template"]["snapshot"]["fixed"][0]["asset_id"] != logo["id"]
        assert document["template"]["snapshot"]["fixed"][0]["asset_id"]
        # A bad example cannot leave a half-imported template.
        before = (await client.get(ROOT + "/templates", params={"query": "atomic-fail"})).json()[
            "total"
        ]
        invalid = copy.deepcopy(example_doc)
        invalid["slides"][0]["elements"][0].update(kind="image", asset_id="missing", paragraphs=[])
        failed = await client.post(
            ROOT + "/library/import",
            json={
                "template": {
                    "title": "atomic-fail",
                    "definition": TemplateDefinition().model_dump(),
                },
                "example": {"title": "missing", "document": invalid},
            },
        )
        assert failed.status_code == 404, failed.text
        assert (await client.get(ROOT + "/templates", params={"query": "atomic-fail"})).json()[
            "total"
        ] == before


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_template_workspace_isolation_and_read_only_permissions():
    from tests.test_account_system import (
        create_test_account,
        login_and_change_password,
        unsafe_headers,
    )

    first_name, first_password = await create_test_account()
    second_name, second_password = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as first,
        httpx.AsyncClient(transport=transport, base_url="http://test") as second,
    ):
        await login_and_change_password(first, first_name, first_password)
        await login_and_change_password(second, second_name, second_password)
        body = {"title": "租户模板", "definition": TemplateDefinition().model_dump()}
        template = (
            await first.post(ROOT + "/templates", json=body, headers=unsafe_headers(first))
        ).json()
        url = ROOT + "/templates/" + template["id"]
        assert (await second.get(url)).status_code == 404
        assert (await second.get(ROOT + "/templates")).json()["total"] == 0
        assert (
            await second.put(
                url, json={**body, "expected_revision": 0}, headers=unsafe_headers(second)
            )
        ).status_code == 404
        assert (
            await second.post(
                url + "/documents",
                json={"title": "bad", "expected_revision": 0},
                headers=unsafe_headers(second),
            )
        ).status_code == 404
        created = (
            await first.post(
                url + "/documents",
                json={"title": "租户文稿", "expected_revision": 0},
                headers=unsafe_headers(first),
            )
        ).json()
        example = (
            await first.post(
                ROOT + "/examples",
                json={"title": "租户示例", "document": created["document"]},
                headers=unsafe_headers(first),
            )
        ).json()
        assert (await second.get(ROOT + "/examples/" + example["id"])).status_code == 404
        key = await first.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={"name": "template-reader", "scopes": ["studio:read"], "expires_in_days": 30},
        )
        assert key.status_code == 201, key.text
        secret = key.json()["secret"]
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {secret}"}
    ) as reader:
        assert (await reader.get(url)).status_code == 200
        assert (await reader.post(ROOT + "/templates", json=body)).status_code == 403
        assert (await reader.put(url, json={**body, "expected_revision": 0})).status_code == 403
        assert (await reader.delete(url, params={"expected_revision": 0})).status_code == 403
        assert (
            await reader.post(
                url + "/documents", json={"title": "forbidden", "expected_revision": 0}
            )
        ).status_code == 403
        request = {"action": "unbind", "expected_revision": 0}
        preview = await reader.post(
            ROOT + "/projects/" + created["id"] + "/template/preview", json=request
        )
        assert preview.status_code == 200, preview.text
        assert (
            await reader.post(
                ROOT + "/projects/" + created["id"] + "/template/apply",
                json={**request, "preview_token": preview.json()["preview_token"]},
            )
        ).status_code == 403


def test_unbinding_full_body_keeps_every_template_object_and_connection_layer():
    from tests.presentation_helpers import element

    document = sample_document().model_dump()
    document.update(
        version=4,
        template={
            "name": "边界模板",
            "snapshot": TemplateDefinition(
                fixed=[{"id": f"fixed-{i}", "kind": "rect", "layer": "behind"} for i in range(40)]
            ).model_dump(),
        },
    )
    document["slides"][0]["title"] = "不能丢失的标题"
    document["slides"][0]["elements"] = [element(id=f"body-{i}", y=400) for i in range(200)]
    document["slides"][0]["connections"] = [
        {"id": "edge", "source_id": "body-0", "target_id": "body-1", "layer": 200}
    ]
    source = PresentationDocument.model_validate(document)
    result = materialize(source)
    assert len(result.slides[0].elements) == 242
    assert result.slides[0].connections[0].layer == 240
    assert sum(e.id.startswith("body-") for e in result.slides[0].elements) == 200
    assert len(source.slides[0].elements) == 200
