from __future__ import annotations

import io
import json
import zipfile

import httpx
import pytest
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.test_thought_workshop import note_body
from tests.thought_helpers import create_note, delete_note

from app.main import app
from app.runtime.config import get_settings

ROOT = "/v1/thought-workshop"


def office(kind):
    stream = io.BytesIO()
    target = {
        "docx": "word/document.xml",
        "xlsx": "xl/workbook.xml",
        "pptx": "ppt/presentation.xml",
    }[kind]
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("_rels/.rels", "<Relationships/>")
        archive.writestr(target, "<document/>")
    return stream.getvalue()


def attachment(asset):
    return {
        "type": "attachment",
        "attrs": {
            "assetId": asset["asset_id"],
            "filename": "伪造名称",
            "mimeType": "bad/type",
            "byteSize": 999,
        },
    }


def document(asset):
    return {"type": "doc", "content": [attachment(asset), {"type": "paragraph"}]}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,mime,content",
    [
        ("文档.pdf", "application/pdf", b"%PDF-1.4\nattachment"),
        ("旧版.doc", "application/msword", bytes.fromhex("d0cf11e0a1b11ae1") + b"office"),
        ("旧版.xls", "application/vnd.ms-excel", bytes.fromhex("d0cf11e0a1b11ae1") + b"office"),
        (
            "旧版.ppt",
            "application/vnd.ms-powerpoint",
            bytes.fromhex("d0cf11e0a1b11ae1") + b"office",
        ),
        ("文档.docx", "application/octet-stream", office("docx")),
        ("表格.xlsx", "application/octet-stream", office("xlsx")),
        ("演示.pptx", "application/octet-stream", office("pptx")),
        ("说明.txt", "text/plain", "仅文件名进入搜索".encode()),
        ("wrong.txt", "application/pdf", b"hello"),
        ("说明.md", "text/markdown", b"# Markdown"),
        ("表格.csv", "text/csv", b"a,b\n1,2"),
        ("数据.json", "application/json", b'{"private":"not indexed"}'),
        ("打包.zip", "application/zip", office("docx")),
    ],
)
async def test_supported_upload_metadata_download_and_normalization(name, mime, content):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(ROOT + "/attachments", files={"upload": (name, content, mime)})
        assert response.status_code == 200, response.text
        asset = response.json()
        if name == "wrong.txt":
            assert asset["mime_type"] == "text/plain"
        assert asset["filename"] == name and asset["byte_size"] == len(content)
        saved = await create_note(client, json={"schema_version": 2, "document": document(asset)})
        assert saved.status_code == 200, saved.text
        note = saved.json()
        assert note["schema_version"] == 3
        assert note["document"]["content"][0]["attrs"] == {
            "assetId": asset["asset_id"],
            "filename": name,
            "mimeType": asset["mime_type"],
            "byteSize": len(content),
        }
        assert note["excerpt"].strip() == name
        downloaded = await client.get(f"/v1/files/{asset['asset_id']}/download")
        assert downloaded.content == content
        assert "attachment" in downloaded.headers["content-disposition"]
        assert (
            await client.delete(f"/v1/files/{asset['asset_id']}", params={"expected_revision": 0})
        ).status_code == 409
        await delete_note(client, ROOT + f"/notes/{note['id']}", params={"expected_revision": 0})
        assert (
            await client.delete(f"/v1/files/{asset['asset_id']}", params={"expected_revision": 0})
        ).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,mime,content",
    [
        ("empty.txt", "text/plain", b""),
        ("fake.pdf", "application/pdf", b"not pdf"),
        ("fake.doc", "application/msword", b"not office"),
        ("wrong.docx", "application/octet-stream", office("xlsx")),
        ("fake.zip", "application/zip", b"PK\x03\x04not-a-zip"),
        ("data.json", "application/json", b"{invalid}"),
        ("text.csv", "text/csv", b"a,b\n" + b"a" * 1024 + b"\x00"),
    ],
)
async def test_reject_spoofed_empty_or_invalid_files(name, mime, content):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(ROOT + "/attachments", files={"upload": (name, content, mime)})
        assert result.status_code == 422, result.text


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_version", [1, 2])
async def test_limits_unlink_cas_backup_and_legacy_import(monkeypatch, legacy_version):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        with monkeypatch.context() as patch:
            patch.setattr(get_settings(), "fpl_visual_asset_max_bytes", 4)
            assert (
                await client.post(
                    ROOT + "/attachments", files={"upload": ("large.txt", b"12345", "text/plain")}
                )
            ).status_code == 413
        asset = (
            await client.post(
                ROOT + "/attachments",
                files={"upload": ("roundtrip.txt", b"private attachment content", "text/plain")},
            )
        ).json()
        note = (
            await create_note(
                client, json={"title": f"附件往返-{legacy_version}", "document": document(asset)}
            )
        ).json()
        backup = await client.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["version"] == 6
            assert archive.read("assets/" + asset["asset_id"]) == b"private attachment content"
        restored = await client.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert restored.status_code == 200, restored.text
        restored_notes = [
            (await client.get(ROOT + f"/notes/{i}")).json() for i in restored.json()["note_ids"]
        ]
        restored_note = next(n for n in restored_notes if n["title"] == note["title"])
        new_id = restored_note["document"]["content"][0]["attrs"]["assetId"]
        assert new_id != asset["asset_id"]
        assert (
            await client.get(f"/v1/files/{new_id}/download")
        ).content == b"private attachment content"
        body = {
            **note_body(note),
            "expected_revision": 0,
            "document": {"type": "doc", "content": [{"type": "paragraph"}]},
        }
        assert (await client.put(ROOT + f"/notes/{note['id']}", json=body)).status_code == 200
        assert (await client.put(ROOT + f"/notes/{note['id']}", json=body)).status_code == 409
        assert (await client.get(f"/v1/files/{asset['asset_id']}/download")).status_code == 200
        assert (
            await client.delete(f"/v1/files/{asset['asset_id']}", params={"expected_revision": 0})
        ).status_code == 409
        old = io.BytesIO()
        with zipfile.ZipFile(old, "w") as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "format": "thought-workshop-backup",
                        "version": legacy_version,
                        "notebooks": [],
                        "assets": [],
                        "notes": [{"title": "旧备份", "schema_version": legacy_version}],
                    }
                ),
            )
        assert (
            await client.post(
                ROOT + "/imports", files={"upload": ("old.zip", old.getvalue(), "application/zip")}
            )
        ).status_code == 200


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_attachment_auth_and_workspace_isolation():
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as a,
        httpx.AsyncClient(transport=transport, base_url="http://test") as b,
    ):
        assert (
            await a.post(ROOT + "/attachments", files={"upload": ("a.txt", b"test", "text/plain")})
        ).status_code == 401
        await login_and_change_password(a, *(await create_test_account()))
        asset = (
            await a.post(
                ROOT + "/attachments",
                headers=unsafe_headers(a),
                files={"upload": ("a.txt", b"secret", "text/plain")},
            )
        ).json()
        url = f"/v1/files/{asset['asset_id']}/download"
        assert (await b.get(url)).status_code == 401
        await login_and_change_password(b, *(await create_test_account()))
        assert (await b.get(url)).status_code == 404
        assert (
            await create_note(b, headers=unsafe_headers(b), json={"document": document(asset)})
        ).status_code == 404
        assert (
            await create_note(
                a,
                headers=unsafe_headers(a),
                json={"document": document({"asset_id": "missing"})},
            )
        ).status_code == 404
