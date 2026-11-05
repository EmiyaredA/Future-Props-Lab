"""v2 native template scenes and explicit, revision-pinned body layout transfers."""

import copy
import io
import json
import sqlite3

import httpx
import pytest
from pptx import Presentation
from tests.migration_fixtures import apply_migrations
from tests.presentation_helpers import element

from db.migrations.runner import connect_database
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.templates.native_scene import default_page
from studio.apps.presentation_workshop.templates.resolver import materialize, resolve_document
from studio.apps.presentation_workshop.templates.schema import TemplateDefinition
from website_test_support import app

ROOT = "/v1/presentation-workshop"


def native_definition(asset_id=None):
    definition = TemplateDefinition(version=2).model_dump()
    for layout in definition["layouts"].values():
        heading = element(id="heading", x=48, y=80, height=60, rotation=4)
        page = element(id="number", x=1176, y=676, width=56, height=22)
        page["paragraphs"][0]["runs"][0]["size"] = 14
        layout["scene"] = {
            "elements": [heading, page],
            "groups": [
                {
                    "id": "title-group",
                    "name": "章节签",
                    "parent_id": None,
                    "element_ids": ["heading"],
                }
            ],
            "semantics": [
                {"element_id": "heading", "role": "title"},
                {"element_id": "number", "role": "number"},
            ],
        }
        layout["defaults"] = {
            "elements": [element(id="body-default", x=60, y=200, width=400, height=180)]
        }
    if asset_id:
        definition["global_scene"] = {
            "elements": [
                element("image", id="logo", asset_id=asset_id, x=1180, y=24, width=60, height=30)
            ]
        }
    return definition


def document(definition):
    d = TemplateDefinition.model_validate(definition)
    slide = default_page(d, "content", "page-1", "template", 0)
    slide.title = "真实标题"
    slide.notes = "不可丢失的备注"
    other = default_page(d, "content", "page-2", "template", 0)
    return PresentationDocument.model_validate(
        {
            "version": 5,
            "width": 1280,
            "height": 720,
            "template": {"template_id": "template", "name": "native", "snapshot": definition},
            "slides": [slide.model_dump(), other.model_dump()],
        }
    )


def test_native_resolver_dynamic_text_groups_detach_and_source_immutable():
    source = document(native_definition())
    before = source.model_dump()
    output, issues = resolve_document(source)
    assert issues == []
    heading = output.slides[0].elements[0]
    assert heading.paragraphs[0].runs[0].text == "真实标题"
    assert heading.rotation == 4 and heading.locked
    assert output.slides[0].groups[0].element_ids == [heading.id]
    assert output.slides[0].elements[-1].paragraphs == source.slides[0].elements[0].paragraphs
    assert source.model_dump() == before
    detached = materialize(source)
    assert detached.template is None and detached.slides[0].layout_source is None
    assert not detached.slides[0].elements[0].locked
    assert detached.slides[0].groups[0].element_ids == [detached.slides[0].elements[0].id]
    assert detached.slides[0].notes == source.slides[0].notes


@pytest.mark.asyncio
async def test_native_layout_mapping_preserves_content_and_checks_both_revisions():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        definition = native_definition()
        t = (
            await c.post(
                ROOT + "/templates", json={"title": "native-layout", "definition": definition}
            )
        ).json()
        d = document(definition).model_dump()
        d["template"]["template_id"] = t["id"]
        p = (await c.post(ROOT + "/projects", json={"title": "layout", "document": d})).json()
        url = ROOT + "/projects/" + p["id"]
        try:
            body = {
                "action": "layout",
                "expected_revision": p["revision"],
                "template_id": t["id"],
                "template_revision": t["revision"],
                "layout_mappings": [
                    {
                        "slide_id": d["slides"][0]["id"],
                        "page_type": "content",
                        "objects": [
                            {
                                "element_id": d["slides"][0]["elements"][0]["id"],
                                "default_id": "body-default",
                            }
                        ],
                    }
                ],
            }
            # Change target geometry without touching body text/crop/notes.
            definition["layouts"]["content"]["defaults"]["elements"][0].update(
                x=900, width=500, rotation=25
            )
            t = (
                await c.put(
                    ROOT + "/templates/" + t["id"],
                    json={
                        "title": t["title"],
                        "definition": definition,
                        "expected_revision": t["revision"],
                    },
                )
            ).json()
            body["template_revision"] = t["revision"]
            preview = await c.post(url + "/template/preview", json=body)
            assert preview.status_code == 200, preview.text
            preview = preview.json()
            codes = {i["code"] for i in preview["issues"]}
            assert {"object_moved", "layout_overflow"} <= codes
            candidate = preview["document"]
            assert candidate["slides"][1] == p["document"]["slides"][1]
            original = p["document"]["slides"][0]["elements"][0]
            moved = candidate["slides"][0]["elements"][0]
            assert moved["paragraphs"] == original["paragraphs"]
            assert moved["crop"] == original["crop"] and moved["asset_id"] == original["asset_id"]
            assert candidate["slides"][0]["notes"] == p["document"]["slides"][0]["notes"]
            assert candidate["template"] == p["document"]["template"]
            stale = {**body, "apply_text_style": True, "preview_token": preview["preview_token"]}
            assert (await c.post(url + "/template/apply", json=stale)).status_code == 409
            p = (
                await c.post(
                    url + "/template/apply",
                    json={**body, "preview_token": preview["preview_token"]},
                )
            ).json()
            assert p["revision"] == 1
            assert (
                await c.post(
                    url + "/template/apply",
                    json={**body, "preview_token": preview["preview_token"]},
                )
            ).status_code == 409
            downgrade = copy.deepcopy(p["document"])
            downgrade["version"] = 4
            downgrade["template"] = None
            for s in downgrade["slides"]:
                s["layout_source"] = None
            assert (
                await c.put(
                    url,
                    json={
                        "title": "old",
                        "expected_revision": p["revision"],
                        "document": downgrade,
                    },
                )
            ).status_code == 422
            exported = await c.post(url + "/export", json={"expected_revision": p["revision"]})
            assert exported.status_code == 200, exported.text
            pptx = Presentation(io.BytesIO(exported.content))
            assert any(
                "真实标题" in shape.text
                for group in pptx.slides[0].shapes
                if hasattr(group, "shapes")
                for shape in group.shapes
                if shape.has_text_frame
            )
            assert len(pptx.slides) == 2
            old = {
                **t,
                "expected_revision": t["revision"],
                "definition": TemplateDefinition().model_dump(),
            }
            for key in ["id", "revision", "created_at", "updated_at"]:
                old.pop(key, None)
            assert (await c.put(ROOT + "/templates/" + t["id"], json=old)).status_code == 422
        finally:
            await c.delete(url, params={"expected_revision": p["revision"]})
            await c.delete(
                ROOT + "/templates/" + t["id"], params={"expected_revision": t["revision"]}
            )


def test_native_migration_preserves_legacy_and_blocks_older_writers(tmp_path):
    path = tmp_path / "native.db"
    apply_migrations(path)
    with connect_database(path) as c:
        for identity, version in [("old", 3), ("new", 5)]:
            c.execute(
                "INSERT INTO presentation_projects VALUES (?,?,?,?,?,?,?)",
                (
                    identity,
                    "default",
                    "native",
                    json.dumps({"version": version}),
                    9,
                    "2026-01-01",
                    "2026-01-01",
                ),
            )
        c.commit()
        with pytest.raises(sqlite3.IntegrityError, match="format downgrade"):
            c.execute(
                "UPDATE presentation_projects SET document=? WHERE id='new'",
                (json.dumps({"version": 4}),),
            )
        assert c.execute(
            "SELECT revision, document FROM presentation_projects WHERE id='old'"
        ).fetchone() == (9, json.dumps({"version": 3}))


def test_native_override_keeps_required_null_fields_and_matches_web_fixture():
    from pathlib import Path

    case = json.loads(
        (Path(__file__).parent / "fixtures/presentation_native_template_cases.json").read_text()
    )
    source = PresentationDocument.model_validate(case["document"])
    source.template_overrides.layouts["content"] = source.template.snapshot.layouts[
        "content"
    ].model_copy(deep=True)
    result, _ = resolve_document(source)
    actual = [
        {
            "elements": [
                {
                    key: getattr(e, key)
                    for key in ("id", "x", "y", "width", "height", "rotation", "hidden", "locked")
                }
                | {"text": "".join(r.text for p in e.paragraphs for r in p.runs)}
                for e in s.elements
            ],
            "groups": [g.model_dump(mode="json") for g in s.groups],
        }
        for s in result.slides
    ]
    assert actual == case["resolved"]


def test_legacy_overrides_survive_native_template_upgrade():
    from studio.apps.presentation_workshop.templates.legacy import preserve_legacy_overrides
    from studio.apps.presentation_workshop.templates.schema import TemplateBinding

    source = document(native_definition())
    source.version = 4
    source.template.snapshot = TemplateDefinition()
    for slide in source.slides:
        slide.layout_source = None
    layout = source.template.snapshot.layouts["content"].model_copy(deep=True)
    layout.title.style.size = 51
    layout.title.x = 92
    source.template_overrides.layouts["content"] = layout
    target = TemplateDefinition.model_validate(native_definition())
    preserve_legacy_overrides(source, target)
    source.template = TemplateBinding(name="upgraded", snapshot=target)
    source.version = 5
    resolved, _ = resolve_document(source)
    title = next(e for e in resolved.slides[0].elements if "-title-" in e.id)
    assert title.x == 92 and title.paragraphs[0].runs[0].size == 51
    assert resolved.slides[0].notes == source.slides[0].notes


def test_semantic_style_required_and_fixed_page_types_are_respected():
    from pydantic import ValidationError

    definition = native_definition()
    definition["global_scene"] = {
        "elements": [element(id="brand")],
        "page_types": {"brand": ["cover"]},
    }
    source = document(definition)
    resolved, _ = resolve_document(source)
    assert resolved.slides[0].elements[0].hidden
    source.slides[0].page_type = "cover"
    resolved, _ = resolve_document(source)
    assert not resolved.slides[0].elements[0].hidden
    assert next(e for e in resolved.slides[0].elements if "-number-" in e.id).hidden
    definition["layouts"]["content"]["scene"]["elements"][0]["paragraphs"][0]["runs"] = []
    with pytest.raises(ValidationError, match="保留文字样式"):
        TemplateDefinition.model_validate(definition)


@pytest.mark.asyncio
async def test_native_default_assets_remain_protected_after_source_template_deleted():
    from tests.test_presentation_image_version import delete_asset, upload

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        asset = await upload(c, "native-default.png")
        definition = native_definition()
        definition["layouts"]["content"]["defaults"]["elements"].append(
            element("image", id="default-art", asset_id=asset["id"])
        )
        template = (
            await c.post(
                ROOT + "/templates", json={"title": "asset scene", "definition": definition}
            )
        ).json()
        source = document(definition).model_dump()
        source["template"]["template_id"] = template["id"]
        p = (
            await c.post(ROOT + "/projects", json={"title": "asset snapshot", "document": source})
        ).json()
        assert (await delete_asset(c, asset)).status_code == 409
        assert (
            await c.delete(
                ROOT + "/templates/" + template["id"],
                params={"expected_revision": template["revision"]},
            )
        ).status_code == 200
        assert (await delete_asset(c, asset)).status_code == 409
        loaded = await c.get(ROOT + "/projects/" + p["id"])
        assert loaded.status_code == 200
        assert (
            len(
                loaded.json()["document"]["template"]["snapshot"]["layouts"]["content"]["defaults"][
                    "elements"
                ]
            )
            == 2
        )
        assert (
            await c.delete(
                ROOT + "/projects/" + p["id"], params={"expected_revision": p["revision"]}
            )
        ).status_code == 200
        assert (await delete_asset(c, asset)).status_code == 200
