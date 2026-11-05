import json
import sqlite3

import pytest
from tests.presentation_helpers import sample_document

from app.capabilities.asset_store.svg import normalize_svg, tint_svg
from app.main import app
from db.migrations.versions.r0058_presentation_media import SQL
from studio.apps.presentation_workshop.schemas.document import PresentationDocument

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    '<path fill="#123456" d="M0 0 L24 0 L12 24 Z"/></svg>'
)


def test_media_migration_is_compatible_and_idempotent(tmp_path):
    old = sample_document().model_dump()
    for slide in old["slides"]:
        for element in slide["elements"]:
            for key in ("opacity", "flip_x", "flip_y", "vector_color", "image_border"):
                element.pop(key)
    old["slides"][0]["elements"][0]["opacity"] = 0.4
    with sqlite3.connect(tmp_path / "media.db") as conn:
        conn.execute("CREATE TABLE presentation_projects (document JSON, revision INTEGER)")
        conn.execute("INSERT INTO presentation_projects VALUES (?, 9)", (json.dumps(old),))
        conn.executescript(SQL)
        once = conn.execute("SELECT document, revision FROM presentation_projects").fetchone()
        conn.executescript(SQL)
        assert (
            conn.execute("SELECT document, revision FROM presentation_projects").fetchone() == once
        )
    assert json.loads(once[0]) == PresentationDocument.model_validate(old).model_dump()
    assert once[1] == 9


def test_svg_normalization_and_tint():
    result = normalize_svg(SVG)
    assert result["width"] == result["height"] == 24
    assert result["monochrome"]
    assert "#ff0000" in tint_svg(SVG, "#ff0000")
    assert normalize_svg(result["svg"]) == result


@pytest.mark.parametrize(
    "child",
    [
        "<script>alert(1)</script>",
        '<image href="https://example.com/a.png"/>',
        '<path onload="alert(1)"/>',
        '<use href="file:///tmp/x"/>',
        "<foreignObject/>",
        "<text>x</text>",
        "<filter/>",
        '<g id="a"><use href="#a"/></g>',
        '<path fill="url(https://example.com/a)"/>',
    ],
)
def test_svg_rejects_unsupported_content(child):
    with pytest.raises(ValueError):
        normalize_svg(f'<svg viewBox="0 0 24 24">{child}</svg>')


@pytest.mark.asyncio
async def test_svg_preview_upload_reference_and_vector_export():
    import io
    from zipfile import ZipFile

    import httpx

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        preview = await client.post("/v1/files/svg/preview", json={"svg": SVG})
        assert preview.status_code == 200, preview.text
        invalid = await client.post("/v1/files/svg/preview", json={"svg": "<svg><script/></svg>"})
        assert invalid.status_code == 422
        asset = await client.post(
            "/v1/files", files={"upload": ("vector.svg", SVG, "image/svg+xml")}
        )
        assert asset.status_code == 200, asset.text
        asset_id = asset.json()["id"]
        hidden = (await client.get("/v1/files", params={"media_kind": "image"})).json()["items"]
        assert asset_id not in [a["id"] for a in hidden]
        visible = (await client.get("/v1/files", params={"include_svg": True})).json()["items"]
        assert asset_id in [a["id"] for a in visible]
        doc = sample_document().model_dump()
        el = doc["slides"][0]["elements"][0]
        el.update(
            kind="vector",
            paragraphs=[],
            asset_id=asset_id,
            vector_color="#FF0000",
            opacity=0.5,
            flip_x=True,
        )
        created = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "矢量验收", "document": doc}
        )
        assert created.status_code == 200, created.text
        project = created.json()
        exported = await client.post(
            f"/v1/presentation-workshop/projects/{project['id']}/export",
            json={"expected_revision": project["revision"]},
        )
        assert exported.status_code == 200, exported.text
        with ZipFile(io.BytesIO(exported.content)) as archive:
            vectors = [n for n in archive.namelist() if n.endswith(".svg")]
            assert len(vectors) == 1
            assert b"#FF0000" in archive.read(vectors[0])
            xml = archive.read("ppt/slides/slide1.xml")
            assert b"svgBlip" in xml and b'flipH="1"' in xml and b'amt="50000"' in xml
            assert any(n.endswith(".png") for n in archive.namelist())
        deleted = await client.delete(
            f"/v1/files/{asset_id}", params={"expected_revision": asset.json()["revision"]}
        )
        assert deleted.status_code == 409
        assert (
            await client.delete(
                f"/v1/presentation-workshop/projects/{project['id']}",
                params={"expected_revision": project["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset_id}", params={"expected_revision": asset.json()["revision"]}
            )
        ).status_code == 200


@pytest.mark.parametrize(
    "kind",
    [
        "rightTriangle",
        "pentagon",
        "hexagon",
        "star",
        "parallelogram",
        "trapezoid",
        "leftArrow",
        "upArrow",
        "downArrow",
        "doubleArrow",
        "callout",
        "roundCallout",
        "ellipseCallout",
    ],
)
def test_new_shapes_export_as_editable_freeforms(tmp_path, kind):
    from pptx import Presentation

    from studio.apps.presentation_workshop.pptx_export import write_pptx

    doc = sample_document().model_dump()
    doc["slides"][0]["elements"][0].update(kind=kind, paragraphs=[])
    target = tmp_path / f"{kind}.pptx"
    write_pptx(PresentationDocument.model_validate(doc), {}, target)
    shape = Presentation(target).slides[0].shapes[0]
    element = doc["slides"][0]["elements"][0]
    assert shape.left == round(element["x"] * 9525)
    assert shape.top == round(element["y"] * 9525)
    assert shape.width == round(element["width"] * 9525)
    assert shape.height == round(element["height"] * 9525)
    assert (
        shape._element.spPr.find("{http://schemas.openxmlformats.org/drawingml/2006/main}custGeom")
        is not None
    )


@pytest.mark.parametrize(
    "bad",
    [
        '<!DOCTYPE svg [<!ENTITY a "hello">]><svg width="2" height="2">&a;</svg>',
        '<svg viewBox="0 0 NaN 2"/>',
        '<svg viewBox="0 0 1 1"><use href="#missing"/></svg>',
    ],
)
def test_svg_rejects_entities_invalid_size_and_missing_references(bad):
    with pytest.raises(ValueError):
        normalize_svg(bad)


def test_svg_gradients_masks_and_multicolor_are_preserved():
    svg = (
        '<svg viewBox="0 0 10 10"><defs><linearGradient id="g">'
        '<stop stop-color="red"/><stop offset="1" stop-color="blue"/>'
        '</linearGradient><mask id="m"><rect width="10" height="10" fill="white"/></mask>'
        '</defs><rect width="10" height="10" fill="url(#g)" mask="url(#m)"/></svg>'
    )
    result = normalize_svg(svg)
    assert not result["monochrome"]
    assert 'mask="url(#m)"' in result["svg"]
    with pytest.raises(ValueError, match="多色"):
        tint_svg(svg, "#FF0000")


def test_svg_rejects_exponentially_expanded_references():
    groups = ['<g id="g0"><rect width="1" height="1"/></g>']
    for index in range(1, 20):
        groups.append(
            f'<g id="g{index}"><use href="#g{index - 1}"/><use href="#g{index - 1}"/></g>'
        )
    with pytest.raises(ValueError, match="过于复杂"):
        normalize_svg(
            '<svg viewBox="0 0 10 10"><defs>' + "".join(groups) + '</defs><use href="#g19"/></svg>'
        )


def test_monochrome_outline_tint_keeps_transparent_fill():
    import io

    import resvg_py
    from PIL import Image

    source = (
        '<svg viewBox="0 0 24 24" fill="none" stroke="#123456" stroke-width="2">'
        '<rect x="3" y="3" width="18" height="18"/></svg>'
    )
    tinted = tint_svg(source, "#FF0000")
    assert 'fill="none"' in tinted
    png = resvg_py.svg_to_bytes(svg_string=tinted, width=96, height=96)
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    assert image.getpixel((48, 48))[3] == 0
    assert image.getpixel((12, 48)) == (255, 0, 0, 255)
