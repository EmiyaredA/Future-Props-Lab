from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import UploadFile

from app.integrations.common import IntegrationValidationError
from app.integrations.skills.archive import SkillArchiveStorage
from studio.config.settings import Settings, get_settings
from website_test_support import app


def skill_zip(description: str, *, size: int | None = None) -> bytes:
    markdown = f"---\nname: full-bundle-fixture\ndescription: {description}\n---\n# Original\n"

    def pack(padding: int) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("SKILL.md", markdown)
            archive.writestr("examples/complete.pdf", b"x" * padding)
        return buffer.getvalue()

    overhead = len(pack(0))
    return pack(0 if size is None else size - overhead)


def settings_at(tmp_path: Path, **limits: int) -> Settings:
    return get_settings().model_copy(
        update={"fpl_database_path": str(tmp_path / "fixture.db"), **limits}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("extra_bytes", [0, 1])
async def test_default_archive_boundary(tmp_path: Path, extra_bytes: int) -> None:
    settings = settings_at(tmp_path)
    assert settings.fpl_skill_archive_max_bytes == 20 * 1024**2
    assert settings.fpl_skill_expanded_max_bytes == 50 * 1024**2
    assert settings.fpl_skill_max_files == 500
    payload = skill_zip("完整简介", size=20 * 1024**2 + extra_bytes)
    storage = SkillArchiveStorage(settings, "fixture")
    upload = UploadFile(file=io.BytesIO(payload), filename="complete.zip")
    if extra_bytes:
        with pytest.raises(IntegrationValidationError, match="20971520 字节限制（20 MiB）"):
            await storage.stage(upload)
        assert not list(storage.root.iterdir())
    else:
        staged = await storage.stage(upload)
        assert staged.file_count == 2
        shutil.rmtree(staged.directory)
    assert upload.file.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("length", [1018, 4000, 4001])
async def test_description_boundary_preserves_original(tmp_path: Path, length: int) -> None:
    storage = SkillArchiveStorage(settings_at(tmp_path), "fixture")
    payload = skill_zip("述" * length)
    upload = UploadFile(file=io.BytesIO(payload), filename="description.zip")
    if length > 4000:
        with pytest.raises(IntegrationValidationError, match="description 必须为 1 到 4000"):
            await storage.stage(upload)
        assert not list(storage.root.iterdir())
    else:
        staged = await storage.stage(upload)
        assert staged.description == "述" * length
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            assert (staged.directory / "SKILL.md").read_bytes() == archive.read("SKILL.md")
        shutil.rmtree(staged.directory)


@pytest.mark.asyncio
async def test_configured_upload_limit_still_overrides_default(tmp_path: Path) -> None:
    storage = SkillArchiveStorage(settings_at(tmp_path, fpl_skill_archive_max_bytes=512), "fixture")
    with pytest.raises(IntegrationValidationError, match="Skill ZIP 超过 512 字节"):
        await storage.stage(
            UploadFile(file=io.BytesIO(skill_zip("test", size=513)), filename="over.zip")
        )
    assert not list(storage.root.iterdir())


@pytest.mark.asyncio
async def test_full_bundle_create_version_and_download_without_truncation() -> None:
    first = skill_zip("a" * 1018, size=11 * 1024**2)
    second = skill_zip("b" * 4000)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/integrations/skills",
            files={"file": ("full.zip", first, "application/zip")},
            data={"enabled": "true", "tags": "完整原包"},
        )
        assert created.status_code == 201, created.text
        skill = created.json()
        skill_id = skill["id"]
        try:
            assert skill["description"] == "a" * 1018
            assert skill["enabled"] is True
            updated = await client.post(
                f"/v1/integrations/skills/{skill_id}/versions",
                files={"file": ("full-v2.zip", second, "application/zip")},
                data={"expected_revision": str(skill["revision"])},
            )
            assert updated.status_code == 200, updated.text
            skill = updated.json()
            assert skill["version_count"] == 2
            assert skill["tags"] == ["完整原包"]
            versions = await client.get(f"/v1/integrations/skills/{skill_id}/versions")
            assert {v["version"]: v["description"] for v in versions.json()} == {
                "v1": "a" * 1018,
                "v2": "b" * 4000,
            }
            for version, original in (("v1", first), ("v2", second)):
                downloaded = await client.get(
                    f"/v1/integrations/skills/{skill_id}/versions/{version}/content"
                )
                assert downloaded.status_code == 200
                with (
                    zipfile.ZipFile(io.BytesIO(original)) as source,
                    zipfile.ZipFile(io.BytesIO(downloaded.content)) as result,
                ):
                    assert sorted(result.namelist()) == sorted(source.namelist())
                    for name in source.namelist():
                        assert result.read(name) == source.read(name)
        finally:
            current = await client.get(f"/v1/integrations/skills/{skill_id}")
            deleted = await client.delete(
                f"/v1/integrations/skills/{skill_id}",
                params={"expected_revision": current.json()["revision"]},
            )
            assert deleted.status_code == 200
