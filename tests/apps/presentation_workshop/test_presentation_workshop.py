import copy
import io
import zipfile

import httpx
import pytest
from PIL import Image
from pptx import Presentation

from studio.apps.presentation_workshop.exports import EXPORT_SLOTS, build_export
from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut
from tests.presentation_helpers import element, sample_document
from website_test_support import app

ROOT = "/v1/presentation-workshop/projects"


@pytest.mark.asyncio
async def test_create_save_conflict_and_native_export():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        body = {"title": "三页验证", "document": sample_document().model_dump()}
        response = await client.post(ROOT, json=body)
        assert response.status_code == 200, response.text
        project = response.json()
        url = ROOT + "/" + project["id"]
        assert (await client.put(url, json=body)).status_code == 422
        body["document"]["slides"][0]["notes"] = "保存后的备注"
        changed = await client.put(url, json={**body, "expected_revision": 0})
        assert changed.status_code == 200, changed.text
        assert changed.json()["revision"] == 1
        assert (await client.get(url)).json()["document"] == body["document"]
        assert (await client.put(url, json={**body, "expected_revision": 0})).status_code == 409
        assert (
            await client.post(url + "/export", json={"expected_revision": 0})
        ).status_code == 409
        exported = await client.post(url + "/export", json={"expected_revision": 1})
        assert exported.status_code == 200, exported.text
        deck = Presentation(io.BytesIO(exported.content))
        assert len(deck.slides) == 3
        assert deck.slides[0].shapes[0].text == "中文标题 Native PPTX"
        assert deck.slides[0].notes_slide.notes_text_frame.text == "保存后的备注"
        assert deck.slides[1].shapes[0].rotation == 30
        assert len(deck.slides[1].shapes) == 2
        assert (
            deck.slides[1]
            .shapes[0]
            ._element.spPr.find("{http://schemas.openxmlformats.org/drawingml/2006/main}effectLst")
            is not None
        )
        assert deck.slides[2].shapes[0].adjustments[1] == pytest.approx(
            0.35 * 250 / 90, abs=0.00002
        )
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            xml = archive.read("ppt/slides/slide1.xml").decode()
            assert 'typeface="Microsoft YaHei"' in xml
            assert "<a:t>" in xml
        listed = (await client.get(ROOT, params={"query": "三页验证"})).json()
        assert listed["items"][0]["slide_count"] == 3
        assert "document" not in listed["items"][0]
        assert (await client.delete(url, params={"expected_revision": 0})).status_code == 409
        assert (await client.delete(url, params={"expected_revision": 1})).status_code == 200
        assert (await client.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_picture_crop_reference_protection_and_atomic_validation():
    image = io.BytesIO()
    Image.new("RGB", (100, 60), "red").save(image, "PNG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        upload = await client.post(
            "/v1/files", files={"upload": ("slide.png", image.getvalue(), "image/png")}
        )
        assert upload.status_code == 200, upload.text
        asset = upload.json()
        doc = sample_document().model_dump()
        doc["slides"][0]["elements"].append(
            element(
                "image",
                id="picture",
                asset_id=asset["id"],
                crop={"left": 0.1, "right": 0.2, "top": 0, "bottom": 0},
            )
        )
        body = {"title": "图片验证", "document": doc}
        response = await client.post(ROOT, json=body)
        assert response.status_code == 200, response.text
        url = ROOT + "/" + response.json()["id"]
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
            )
        ).status_code == 409
        exported = await client.post(url + "/export", json={"expected_revision": 0})
        assert exported.status_code == 200, exported.text
        picture = Presentation(io.BytesIO(exported.content)).slides[0].shapes[1]
        assert picture.crop_left == pytest.approx(0.1)
        assert picture.crop_right == pytest.approx(0.2)
        invalid = copy.deepcopy(body)
        invalid["document"]["slides"][0]["elements"][1]["asset_id"] = "missing"
        assert (await client.put(url, json={**invalid, "expected_revision": 0})).status_code == 404
        assert (await client.get(url)).json()["revision"] == 0
        assert (await client.delete(url, params={"expected_revision": 0})).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_document_bounds_and_unknown_fields():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        doc = sample_document().model_dump()
        for mutation in (
            lambda d: d.update(slides=[]),
            lambda d: d["slides"].append(d["slides"][0]),
            lambda d: d["slides"][0].update(elements=[element()] * 101),
        ):
            invalid = copy.deepcopy(doc)
            mutation(invalid)
            assert (
                await client.post(ROOT, json={"title": "错误", "document": invalid})
            ).status_code == 422
        assert (
            await client.post(
                ROOT, json={"title": "错误", "document": doc, "owner_user_id": "test-user"}
            )
        ).status_code == 422


def test_export_busy_and_missing_image_cleanup(tmp_path):
    project = PresentationProjectOut(
        id="test",
        title="验证",
        revision=0,
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        document=sample_document(),
    )
    EXPORT_SLOTS.acquire()
    EXPORT_SLOTS.acquire()
    try:
        with pytest.raises(PresentationError, match="繁忙"):
            build_export(project, {})
    finally:
        EXPORT_SLOTS.release()
        EXPORT_SLOTS.release()
    with pytest.raises(PresentationError, match="图片缺失"):
        build_export(project, {"missing": tmp_path / "missing.png"})
