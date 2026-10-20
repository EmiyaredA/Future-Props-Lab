import io
import wave
import zipfile

import httpx
import pytest
import pytest_asyncio
from PIL import Image
from pptx import Presentation
from tests.presentation_helpers import element, sample_document

from app.apps.presentation_workshop.exchange.pptx_import import read_pptx
from app.apps.presentation_workshop.pptx_export import write_pptx
from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.main import app

ROOT = "/v1/presentation-workshop"


@pytest_asyncio.fixture(autouse=True)
async def cleanup_transfer_resources(request):
    if request.node.get_closest_marker("asyncio") is None or request.node.get_closest_marker(
        "real_auth"
    ):
        yield
        return
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        projects = {item["id"] for item in (await client.get(ROOT + "/projects")).json()["items"]}
        files = {
            item["id"]
            for item in (await client.get("/v1/files", params={"include_svg": True})).json()[
                "items"
            ]
        }
        yield
        for item in (await client.get(ROOT + "/projects")).json()["items"]:
            if item["id"] not in projects:
                await client.delete(
                    ROOT + "/projects/" + item["id"], params={"expected_revision": item["revision"]}
                )
        for item in (await client.get("/v1/files", params={"include_svg": True})).json()["items"]:
            if item["id"] not in files:
                await client.delete(
                    "/v1/files/" + item["id"], params={"expected_revision": item["revision"]}
                )


def objects_document():
    document = sample_document().model_dump()
    document["slides"][0]["elements"] = [
        element(
            "table",
            id="table",
            table={
                "rows": [[{"text": "A"}, {"text": "B"}], [{"text": "C"}, {"text": "D"}]],
                "column_widths": [1, 2],
            },
        ),
        element(
            "chart",
            id="chart",
            chart={
                "type": "column",
                "categories": ["一", "二"],
                "series": [{"name": "销量", "values": [12, 24]}],
            },
        ),
    ]
    return PresentationDocument.model_validate(document)


@pytest.mark.asyncio
async def test_native_objects_and_package_json_pptx_round_trips():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            ROOT + "/projects",
            json={"title": "往返测试", "document": objects_document().model_dump()},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = ROOT + "/projects/" + project["id"]
        exported = await client.post(url + "/export", json={"expected_revision": 0})
        assert exported.status_code == 200, exported.text
        deck = Presentation(io.BytesIO(exported.content))
        assert deck.slides[0].shapes[0].has_table
        assert deck.slides[0].shapes[0].table.cell(1, 1).text == "D"
        assert deck.slides[0].shapes[1].has_chart
        assert list(deck.slides[0].shapes[1].chart.series[0].values) == [12, 24]
        for format in ["json", "fplppt"]:
            content = await client.post(url + "/export/" + format, json={"expected_revision": 0})
            assert content.status_code == 200, content.text
            files = {"upload": ("deck." + format, content.content)}
            before = (await client.get(ROOT + "/projects")).json()["total"]
            preview = await client.post(ROOT + "/imports/preview", files=files)
            assert preview.status_code == 200, preview.text
            assert (await client.get(ROOT + "/projects")).json()["total"] == before
            imported = await client.post(ROOT + "/imports", files=files)
            assert imported.status_code == 200, imported.text
            clone = imported.json()
            assert clone["id"] != project["id"]
            assert clone["document"]["slides"][0]["id"] != project["document"]["slides"][0]["id"]
            assert (
                clone["document"]["slides"][0]["elements"][1]["chart"]
                == project["document"]["slides"][0]["elements"][1]["chart"]
            )
        parsed = read_pptx(exported.content, "test")
        assert {i.code for i in parsed.issues} <= {
            "chart_style",
            "table_style",
            "master_content",
            "font_substitution",
            "theme_colors",
        }
        assert parsed.document.slides[0].elements[0].table.rows[1][1].text == "D"
        assert parsed.document.slides[0].elements[1].chart.series[0].values == [12, 24]


@pytest.mark.asyncio
async def test_package_assets_receive_new_ids_and_are_protected():
    image = io.BytesIO()
    Image.new("RGB", (64, 32), "red").save(image, "PNG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        asset = (
            await client.post(
                "/v1/files", files={"upload": ("picture.png", image.getvalue(), "image/png")}
            )
        ).json()
        document = sample_document().model_dump()
        document["slides"][0]["elements"] = [element("image", asset_id=asset["id"])]
        created = (
            await client.post(ROOT + "/projects", json={"title": "带图文稿", "document": document})
        ).json()
        content = await client.post(
            ROOT + "/projects/" + created["id"] + "/export/fplppt", json={"expected_revision": 0}
        )
        files = {"upload": ("images.fplppt", content.content)}
        preview = await client.post(ROOT + "/imports/preview", files=files)
        assert preview.status_code == 200, preview.text
        assert preview.json()["preview_assets"][asset["id"]].startswith("data:image/png;base64,")
        imported = await client.post(ROOT + "/imports", files=files)
        assert imported.status_code == 200, imported.text
        new_asset = imported.json()["document"]["slides"][0]["elements"][0]["asset_id"]
        assert new_asset != asset["id"]
        assert (await client.get(f"/v1/files/{new_asset}/content")).content == image.getvalue()
        assert (
            await client.delete(f"/v1/files/{new_asset}", params={"expected_revision": 0})
        ).status_code == 409


@pytest.mark.asyncio
async def test_invalid_archives_and_failed_import_do_not_leave_files_or_projects():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../escape", "x")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        before = (await client.get(ROOT + "/projects")).json()["total"]
        result = await client.post(
            ROOT + "/imports", files={"upload": ("bad.fplppt", buffer.getvalue())}
        )
        assert result.status_code == 422, result.text
        assert (await client.get(ROOT + "/projects")).json()["total"] == before


@pytest.mark.parametrize(
    "kind", ["column", "bar", "line", "area", "scatter", "pie", "ring", "radar"]
)
def test_chart_types_export_as_editable_objects(tmp_path, kind):
    document = objects_document().model_dump()
    chart = document["slides"][0]["elements"][1]["chart"]
    chart.update(type=kind, categories=["1", "2"])
    path = tmp_path / (kind + ".pptx")
    write_pptx(PresentationDocument.model_validate(document), {}, path)
    deck = Presentation(path)
    assert deck.slides[0].shapes[1].has_chart
    assert len(deck.slides[0].shapes[1].chart.series[0].values) == 2


@pytest.mark.asyncio
async def test_audio_export_embeds_audio_relationships_and_references():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\0\0" * 800)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            "/v1/files", files={"upload": ("audio.wav", buffer.getvalue(), "audio/wav")}
        )
        assert uploaded.status_code == 200, uploaded.text
        document = sample_document().model_dump()
        document["slides"][0]["elements"] = [
            element("audio", asset_id=uploaded.json()["id"], media={"autoplay": True, "loop": True})
        ]
        project = await client.post(
            ROOT + "/projects", json={"title": "音频", "document": document}
        )
        assert project.status_code == 200, project.text
        exported = await client.post(
            ROOT + "/projects/" + project.json()["id"] + "/export", json={"expected_revision": 0}
        )
        assert exported.status_code == 200, exported.text
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            slide = archive.read("ppt/slides/slide1.xml").decode()
            assert "audioFile" in slide and "<p:audio" in slide
            assert 'repeatCount="indefinite"' in slide
            assert "/audio" in archive.read("ppt/slides/_rels/slide1.xml.rels").decode()


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_package_cross_workspace_remaps_background_assets():
    from contextlib import aclosing

    from test_workspace_governance import client_account

    owner, *_ = await client_account()
    receiver, *_ = await client_account()
    async with aclosing(owner), aclosing(receiver):
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "green").save(image, "PNG")
        asset = (
            await owner.post(
                "/v1/files", files={"upload": ("bg.png", image.getvalue(), "image/png")}
            )
        ).json()
        document = sample_document().model_dump()
        document["slides"][0]["background_style"] = {"type": "image", "asset_id": asset["id"]}
        project = (
            await owner.post(ROOT + "/projects", json={"title": "跨空间背景", "document": document})
        ).json()
        assert (
            await receiver.post(
                ROOT + "/projects", json={"title": "非法引用", "document": document}
            )
        ).status_code == 404
        package = await owner.post(
            ROOT + "/projects/" + project["id"] + "/export/fplppt", json={"expected_revision": 0}
        )
        imported = await receiver.post(
            ROOT + "/imports", files={"upload": ("bg.fplppt", package.content)}
        )
        assert imported.status_code == 200, imported.text
        copy = imported.json()
        identity = copy["document"]["slides"][0]["background_style"]["asset_id"]
        assert identity != asset["id"]
        assert (await receiver.get("/v1/files/" + asset["id"] + "/content")).status_code == 404
        assert (
            await receiver.get("/v1/files/" + identity + "/content")
        ).content == image.getvalue()
        await receiver.delete(ROOT + "/projects/" + copy["id"], params={"expected_revision": 0})
        await receiver.delete("/v1/files/" + identity, params={"expected_revision": 0})
        await owner.delete(ROOT + "/projects/" + project["id"], params={"expected_revision": 0})
        await owner.delete("/v1/files/" + asset["id"], params={"expected_revision": 0})


@pytest.mark.asyncio
async def test_import_transaction_failure_removes_prepared_files(monkeypatch):
    from app.apps.presentation_workshop.projects import PresentationError, Presentations
    from app.capabilities.asset_store.library import AssetLibrary

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        image = io.BytesIO()
        Image.new("RGB", (16, 16), "blue").save(image, "PNG")
        asset = (
            await client.post(
                "/v1/files", files={"upload": ("test.png", image.getvalue(), "image/png")}
            )
        ).json()
        doc = sample_document().model_dump()
        doc["slides"][0]["elements"] = [element("image", asset_id=asset["id"])]
        project = (
            await client.post(ROOT + "/projects", json={"title": "清理测试", "document": doc})
        ).json()
        package = await client.post(
            ROOT + "/projects/" + project["id"] + "/export/fplppt", json={"expected_revision": 0}
        )
        paths = []
        stage = AssetLibrary.stage_local_copy

        async def remember(self, *args, **kwargs):
            row, path = await stage(self, *args, **kwargs)
            paths.append(path)
            return row, path

        async def fail(*_args, **_kwargs):
            raise PresentationError("测试事务拒绝", 422, "test_failure")

        monkeypatch.setattr(AssetLibrary, "stage_local_copy", remember)
        monkeypatch.setattr(Presentations, "create", fail)
        failed = await client.post(
            ROOT + "/imports", files={"upload": ("fail.fplppt", package.content)}
        )
        assert failed.status_code == 422, failed.text
        assert paths and all(not path.exists() for path in paths)
        assert (await client.get(ROOT + "/projects/" + project["id"])).status_code == 200


@pytest.mark.asyncio
async def test_sdk_export_preview_and_package_import_round_trip(tmp_path):
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))
    from future_props_lab import AsyncClient
    from future_props_lab.streams import AsyncDownload

    async with AsyncClient(base_url="http://test", transport=httpx.ASGITransport(app=app)) as sdk:
        source = await sdk.presentation.create_project(
            body={"title": "SDK v3", "document": objects_document().model_dump()}
        )
        report = await sdk.presentation.preview_export(
            project_id=source.id, body={"expected_revision": 0}
        )
        assert report.issues == []
        download = await sdk.presentation.export_file(
            project_id=source.id, format="fplppt", body={"expected_revision": 0}
        )
        assert isinstance(download, AsyncDownload)
        async with download:
            path = await download.save(tmp_path / "sdk.fplppt")
        with path.open("rb") as file:
            preview = await sdk.presentation.preview_import(
                body={}, files={"upload": ("sdk.fplppt", file, "application/zip")}
            )
        assert preview.document.slides[0].elements[0].kind == "table"
        with path.open("rb") as file:
            imported = await sdk.presentation.import_project(
                body={"allow_lossy": False},
                files={"upload": ("sdk.fplppt", file, "application/zip")},
            )
        assert imported.id != source.id
        async with await sdk.presentation.export_file(
            project_id=imported.id, format="json", body={"expected_revision": 0}
        ) as exported:
            json_file = await exported.save(tmp_path / "sdk.json")
        import json

        assert json.loads(json_file.read_text())["document"]["version"] == 3
