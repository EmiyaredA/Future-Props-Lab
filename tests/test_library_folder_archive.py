from __future__ import annotations

import io
import zipfile

import httpx
import pytest
from sqlalchemy import delete

from app.core.db import SessionLocal
from app.main import app
from app.models import VisualAsset, VisualAssetFolder

PNG = b"\x89PNG\r\n\x1a\nfolder-archive"


async def _reset_library() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VisualAsset))
        await session.execute(delete(VisualAssetFolder))
        await session.commit()


def _zip_bytes(members: dict[str, bytes | None]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            if payload is None:
                archive.writestr(name if name.endswith("/") else f"{name}/", b"")
            else:
                archive.writestr(name, payload)
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_library_folder_export_import_roundtrip_and_merge() -> None:
    await _reset_library()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        parent = (
            await client.post(
                "/v1/file-folders",
                json={"scope": "library", "name": "素材库"},
            )
        ).json()
        child = (
            await client.post(
                "/v1/file-folders",
                json={"scope": "library", "name": "角色", "parent_id": parent["id"]},
            )
        ).json()
        empty = (
            await client.post(
                "/v1/file-folders",
                json={"scope": "library", "name": "空目录", "parent_id": parent["id"]},
            )
        ).json()
        assert empty["name"] == "空目录"
        first = (
            await client.post(
                "/v1/files",
                data={"folder_id": child["id"]},
                files={"upload": ("hero.png", PNG + b"-1", "image/png")},
            )
        ).json()
        second = (
            await client.post(
                "/v1/files",
                data={"folder_id": child["id"]},
                files={"upload": ("hero.png", PNG + b"-2", "image/png")},
            )
        ).json()
        assert first["display_name"] == second["display_name"] == "hero"

        exported = await client.get(
            "/v1/file-library/folder-exports",
            params={"folder_id": parent["id"]},
        )
        assert exported.status_code == 200, exported.text
        assert exported.headers["content-type"].startswith("application/zip")
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            names = set(archive.namelist())
            assert "素材库/" in names or any(name.startswith("素材库/") for name in names)
            assert "素材库/空目录/" in names
            assert "素材库/角色/hero.png" in names
            assert "素材库/角色/hero-2.png" in names

        await _reset_library()
        imported = await client.post(
            "/v1/file-library/folder-archive-imports",
            files={"archive": ("library.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        body = imported.json()
        assert body["created_folders"] >= 3
        assert body["created_files"] == 2
        assert body["skipped"] == []

        folders = (await client.get("/v1/file-folders")).json()["items"]
        by_name = {folder["name"]: folder for folder in folders}
        assert "素材库" in by_name
        assert "角色" in by_name
        assert "空目录" in by_name

        merge = await client.post(
            "/v1/file-library/folder-archive-imports",
            files={"archive": ("library.zip", exported.content, "application/zip")},
        )
        assert merge.status_code == 200, merge.text
        merge_body = merge.json()
        assert merge_body["created_folders"] == 0
        assert merge_body["created_files"] == 2

        listed = (
            await client.get("/v1/files", params={"folder_id": by_name["角色"]["id"]})
        ).json()["items"]
        assert len(listed) == 4


@pytest.mark.asyncio
async def test_library_folder_entry_imports_preserve_relative_paths() -> None:
    await _reset_library()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        result = await client.post(
            "/v1/file-library/folder-entry-imports",
            data={"relative_paths": ["道具/贴图/icon.png", "道具/说明.txt"]},
            files=[
                ("files", ("icon.png", PNG, "image/png")),
                ("files", ("说明.txt", b"hello props", "text/plain")),
            ],
        )
        assert result.status_code == 200, result.text
        body = result.json()
        assert body["created_folders"] == 2
        assert body["created_files"] == 2
        assert body["skipped"] == []
        folders = (await client.get("/v1/file-folders")).json()["items"]
        props = next(folder for folder in folders if folder["name"] == "道具")
        texture = next(folder for folder in folders if folder["name"] == "贴图")
        assert texture["parent_id"] == props["id"]
        files = (
            await client.get("/v1/files", params={"folder_id": texture["id"]})
        ).json()["items"]
        assert len(files) == 1
        assert files[0]["display_name"] == "icon"


@pytest.mark.asyncio
async def test_library_folder_import_skips_unsafe_and_unsupported_entries() -> None:
    await _reset_library()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        unsafe = _zip_bytes({"../escape.png": PNG})
        denied = await client.post(
            "/v1/file-library/folder-archive-imports",
            files={"archive": ("bad.zip", unsafe, "application/zip")},
        )
        assert denied.status_code == 422
        assert denied.json()["code"] == "unsafe_archive_path"

        mixed = _zip_bytes(
            {
                "ok/a.png": PNG,
                "ok/notes.exe": b"MZ",
                "a/b/c/d/e/f/too-deep.png": PNG,
            }
        )
        result = await client.post(
            "/v1/file-library/folder-archive-imports",
            files={"archive": ("mixed.zip", mixed, "application/zip")},
        )
        assert result.status_code == 200, result.text
        body = result.json()
        assert body["created_files"] == 1
        codes = {item["code"] for item in body["skipped"]}
        assert "unsupported_file_type" in codes
        assert "folder_depth_exceeded" in codes


@pytest.mark.asyncio
async def test_library_folder_routes_are_registered_for_content_permissions() -> None:
    from app.accounts.route_permissions import route_permission

    assert route_permission("GET", "/v1/file-library/folder-exports") == "content.read"
    assert (
        route_permission("POST", "/v1/file-library/folder-archive-imports") == "content.write"
    )
    assert route_permission("POST", "/v1/file-library/folder-entry-imports") == "content.write"
