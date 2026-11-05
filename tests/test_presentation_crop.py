import io
import json
from pathlib import Path

import httpx
import pytest
from PIL import Image, ImageDraw
from pptx import Presentation
from tests.presentation_helpers import element, sample_document

from app.main import app
from studio.apps.presentation_workshop.exports import build_export
from studio.apps.presentation_workshop.image_crop import cover_crop, pptx_crop
from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut

CASES = json.loads((Path(__file__).parent / "fixtures/presentation_crop_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_crop_vectors(case):
    result = cover_crop(*case["image"], *case["frame"], case["crop"])
    assert result == pytest.approx(case["expected"])
    width, height = case["image"]
    visible_w = width * (1 - result["left"] - result["right"])
    visible_h = height * (1 - result["top"] - result["bottom"])
    assert case["frame"][0] / visible_w == pytest.approx(case["frame"][1] / visible_h)
    for side in result:
        assert result[side] >= case["crop"][side] - 1e-12
    assert pptx_crop(*case["image"], *case["frame"], case["crop"]) == pytest.approx(result)


def test_extreme_crop_precision_reports_an_error():
    with pytest.raises(PresentationError, match="比例过于极端") as error:
        pptx_crop(10000, 1, 1, 10000, dict.fromkeys(["left", "right", "top", "bottom"], 0))
    assert error.value.status == 422
    assert error.value.code == "export_crop_precision"


def test_native_picture_preserves_original_grid_and_square_scale(tmp_path):
    image = Image.new("RGB", (400, 200), "white")
    draw = ImageDraw.Draw(image)
    for x in range(0, 400, 20):
        draw.line((x, 0, x, 200), fill="#bbbbbb")
    for y in range(0, 200, 20):
        draw.line((0, y, 400, y), fill="#bbbbbb")
    draw.ellipse((150, 50, 250, 150), outline="red", width=4)
    draw.rectangle((155, 55, 245, 145), outline="blue", width=3)
    source = tmp_path / "grid.png"
    image.save(source)
    document = sample_document()
    picture = element("image", id="grid", asset_id="grid", width=220, height=220, rotation=24)
    document.slides[0].elements = [type(document.slides[0].elements[0]).model_validate(picture)]
    snapshot = PresentationProjectOut(
        id="test",
        title="比例测试",
        revision=0,
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        document=document,
    )
    output = build_export(snapshot, {"grid": source})
    try:
        shape = Presentation(output.path).slides[0].shapes[0]
        assert shape.image.size == (400, 200)
        assert shape.rotation == 24
        assert shape.width / 9525 == 220
        assert shape.height / 9525 == 220
        assert shape.crop_left == shape.crop_right == 0.25
        assert shape.crop_top == shape.crop_bottom == 0
        with Image.open(io.BytesIO(shape.image.blob)) as embedded:
            assert embedded.convert("RGB").tobytes() == image.tobytes()
        sx = shape.width / (400 * (1 - shape.crop_left - shape.crop_right))
        sy = shape.height / (200 * (1 - shape.crop_top - shape.crop_bottom))
        assert sx == sy
        assert snapshot.document.slides[0].elements[0].crop.left == 0
    finally:
        output.cleanup()


def test_exif_orientation_is_applied_before_fitting(tmp_path):
    source = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (400, 200), "blue")
    exif = image.getexif()
    exif[274] = 6
    image.save(source, exif=exif)
    doc = sample_document()
    picture = element("image", asset_id="rotated", width=220, height=220)
    doc.slides[0].elements = [type(doc.slides[0].elements[0]).model_validate(picture)]
    project = PresentationProjectOut(
        id="test",
        title="方向",
        revision=0,
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        document=doc,
    )
    output = build_export(project, {"rotated": source})
    try:
        shape = Presentation(output.path).slides[0].shapes[0]
        assert shape.image.size == (200, 400)
        assert shape.crop_left == shape.crop_right == 0
        assert shape.crop_top == shape.crop_bottom == 0.25
    finally:
        output.cleanup()


@pytest.mark.asyncio
async def test_unrepresentable_crop_returns_explicit_api_error():
    image = io.BytesIO()
    Image.new("RGB", (1000, 1), "white").save(image, "PNG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            "/v1/files", files={"upload": ("wide.png", image.getvalue(), "image/png")}
        )
        assert uploaded.status_code == 200
        doc = sample_document().model_dump()
        doc["slides"][0]["elements"] = [
            element("image", asset_id=uploaded.json()["id"], width=1, height=10000)
        ]
        created = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "极端比例", "document": doc}
        )
        assert created.status_code == 200
        endpoint = "/v1/presentation-workshop/projects/" + created.json()["id"]
        response = await client.post(endpoint + "/export", json={"expected_revision": 0})
        assert response.status_code == 422
        assert response.json()["code"] == "export_crop_precision"
        assert (await client.get(endpoint)).json()["document"] == doc
        assert (await client.delete(endpoint, params={"expected_revision": 0})).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{uploaded.json()['id']}",
                params={"expected_revision": uploaded.json()["revision"]},
            )
        ).status_code == 200
