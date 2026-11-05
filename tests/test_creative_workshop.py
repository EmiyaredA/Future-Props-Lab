from __future__ import annotations

import io
import shutil
import zipfile

import pytest
from fastapi import UploadFile
from sqlalchemy import select
from tests.account_fixtures import account_record

from studio.apps.creative_workshop.storage.catalog_files import resolve_file
from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease
from studio.apps.identity.storage.models.accounts import User
from studio.apps.integrations.storage.models import (
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from studio.assembly.website.creative import website_catalog as CreativeCatalog
from studio.assembly.website.creative import website_installer as CreativeInstaller
from studio.contracts.creative_workshop.catalog import (
    CreativeDraftIn,
    CreativeDraftUpdateIn,
    CreativeInstallPreviewIn,
    CreativeStdioSetupIn,
)
from studio.contracts.creative_workshop.errors import CreativeError, CreativeFileError
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.secrets import SecretCipher
from website_test_support import SessionLocal, settings
from website_test_support import settings as isolated_settings


def principal(user_id: str, _owner_user_id: str, _role: str = "admin") -> StudioPrincipal:
    return StudioPrincipal(
        platform_role="admin",
        user_id=user_id,
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )


@pytest.mark.asyncio
async def test_cross_workspace_public_catalog_and_atomic_install() -> None:
    async with SessionLocal() as session:
        session.add_all(
            [
                User(
                    id="creative-a",
                    username="creative-a",
                    username_normalized="creative-a",
                    password_hash="unused",
                ),
                User(
                    id="creative-b",
                    username="creative-b",
                    username_normalized="creative-b",
                    password_hash="unused",
                ),
                User(
                    id="creative-c",
                    username="creative-c",
                    username_normalized="creative-c",
                    password_hash="unused",
                ),
            ]
        )
        await session.commit()
        author = CreativeCatalog(
            session, principal("creative-a", "creative-a", "user"), settings=settings
        )
        viewer = CreativeCatalog(session, principal("creative-b", "creative-b"), settings=settings)
        tool = await author.create(
            CreativeDraftIn(
                kind="tool_api",
                title="Weather",
                summary="Forecast API",
                manifest={
                    "method": "GET",
                    "url": "https://weather.example.com/api",
                    "auth_kind": "bearer",
                },
            )
        )
        assert (await viewer.list(kind=None, query="", mine=False, cursor=0, limit=24)).items == []
        with pytest.raises(CreativeError):
            await viewer.get(tool.id, draft=True)
        published = await author.publish(tool.id, tool.revision)
        public = await viewer.list(kind=None, query="Weather", mine=False, cursor=0, limit=24)
        assert len(public.items) == 1
        assert public.items[0].origin_owner_user_id == "creative-a"
        assert "secret" not in str(public.items[0].manifest).lower()
        assert public.items[0].current_release_id == published.current_release_id
        session.add(
            ToolApiIntegration(
                id="creative-private-source",
                owner_user_id="creative-a",
                name="Imported",
                description="Imported tool",
                method="GET",
                url="https://example.com/public",
                auth_kind="bearer",
                secret_ciphertext="encrypted-secret-never-publish",
                parameters_schema={"type": "object", "properties": {}},
            )
        )
        await session.commit()
        imported = await CreativeCatalog(
            session, principal("creative-a", "creative-a", "admin"), settings=settings
        ).import_source("tool_api", "creative-private-source")
        imported = await author.publish(imported.id, imported.revision)
        assert "encrypted-secret-never-publish" not in imported.model_dump_json()
        assert (
            "encrypted-secret-never-publish"
            not in (await viewer.get_release(imported.current_release_id)).model_dump_json()
        )
        bundle = await author.create(
            CreativeDraftIn(
                kind="bundle",
                title="Weather workflow",
                summary="Forecast bundle",
                components=[published.current_release_id],
            )
        )
        bundle = await author.publish(bundle.id, bundle.revision)
        assert bundle.components == [published.current_release_id]
        own_preview = await CreativeInstaller(
            session,
            principal("creative-a", "creative-a", "user"),
            settings=settings,
            cipher=SecretCipher(settings.fpl_secrets_key),
        ).preview(CreativeInstallPreviewIn(release_id=bundle.current_release_id))
        assert own_preview.installable
        installer = CreativeInstaller(
            session,
            principal("creative-b", "creative-b"),
            settings=settings,
            cipher=SecretCipher(settings.fpl_secrets_key),
        )
        install_body = CreativeInstallPreviewIn(release_id=bundle.current_release_id)
        preview = await installer.preview(install_body)
        assert preview.installable and len(preview.parts) == 1
        installed = await installer.install(install_body)
        assert len(installed.resources) == 1
        assert (await installer.install(install_body)).already_installed
        row = await session.scalar(
            select(ToolApiIntegration).where(ToolApiIntegration.owner_user_id == "creative-b")
        )
        assert row and row.enabled is False and row.secret_ciphertext == ""
        assert row.auth_kind == "bearer"
        same_name = await author.create(
            CreativeDraftIn(
                kind="tool_api",
                title="Weather",
                summary="Other forecast",
                manifest={"method": "GET", "url": "https://other.example.com/weather"},
            )
        )
        same_name = await author.publish(same_name.id, same_name.revision)
        assert not (
            await installer.preview(
                CreativeInstallPreviewIn(
                    release_id=same_name.current_release_id,
                )
            )
        ).installable
        renamed = CreativeInstallPreviewIn(
            release_id=same_name.current_release_id,
            names={same_name.current_release_id: "Weather alternate"},
        )
        assert (await installer.preview(renamed)).installable
        await installer.install(renamed)
        changed = await author.update(
            tool.id,
            CreativeDraftUpdateIn(
                kind="tool_api",
                title="Weather v2",
                summary="Forecast API 2",
                manifest={"method": "GET", "url": "https://weather.example.com/v2"},
                expected_revision=published.revision,
            ),
        )
        await author.publish(tool.id, changed.revision)
        await session.refresh(row)
        assert row.url == "https://weather.example.com/api"
        old_release = await session.get(CreativeRelease, published.current_release_id)
        assert old_release and old_release.title == "Weather"
        stdio = await author.create(
            CreativeDraftIn(
                kind="mcp",
                title="Local MCP",
                summary="Local process",
                manifest={"transport": "stdio", "command_hint": "用 npm 安装"},
            )
        )
        stdio = await author.publish(stdio.id, stdio.revision)
        stdio_install = await installer.install(
            CreativeInstallPreviewIn(
                release_id=stdio.current_release_id,
            )
        )
        assert stdio_install.resources[0]["state"] == "pending_setup"
        configured = await installer.configure_stdio(
            stdio_install.id,
            CreativeStdioSetupIn(
                release_id=stdio.current_release_id,
                command="npx",
                arguments=["-y", "demo"],
            ),
        )
        assert configured.resources[0]["state"] == "disabled"
        mcp = await session.scalar(
            select(McpIntegration).where(McpIntegration.owner_user_id == "creative-b")
        )
        assert mcp and mcp.command == "npx" and not mcp.enabled
        skill = await author.create(
            CreativeDraftIn(
                kind="skill",
                title="Sample",
                summary="Sample Skill",
            )
        )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(
                "SKILL.md",
                "---\nname: sample\ndescription: Sample skill\n---\n# Sample\n",
            )
        skill = await author.upload_skill(
            skill.id,
            skill.revision,
            UploadFile(file=io.BytesIO(archive.getvalue()), filename="sample.zip"),
        )
        skill = await author.publish(skill.id, skill.revision)
        broken_bundle = await author.create(
            CreativeDraftIn(
                kind="bundle",
                title="Broken copy",
                summary="Checks rollback",
                components=[published.current_release_id, skill.current_release_id],
            )
        )
        broken_bundle = await author.publish(broken_bundle.id, broken_bundle.revision)
        skill_release = await session.get(CreativeRelease, skill.current_release_id)
        assert skill_release
        shutil.rmtree(resolve_file("creative-a", skill_release.skill_path, settings=settings))
        other_installer = CreativeInstaller(
            session,
            principal("creative-c", "creative-c"),
            settings=settings,
            cipher=SecretCipher(settings.fpl_secrets_key),
        )
        with pytest.raises(CreativeError):
            await other_installer.install(
                CreativeInstallPreviewIn(
                    release_id=broken_bundle.current_release_id,
                )
            )
        assert (
            await session.scalar(
                select(ToolApiIntegration).where(ToolApiIntegration.owner_user_id == "creative-c")
            )
            is None
        )
        withdrawn = await author.withdraw(tool.id, changed.revision + 1)
        assert withdrawn.status == "withdrawn"
        assert not (await viewer.get(bundle.id)).installable
        old_component = await viewer.get_release(published.current_release_id)
        assert old_component.title == "Weather" and not old_component.installable
        with pytest.raises(CreativeError):
            await installer.preview(install_body)


@pytest.mark.asyncio
async def test_public_manifest_rejects_credentials_and_empty_bundle() -> None:
    async with SessionLocal() as session:
        if not await session.get(User, "creative-a"):
            session.add(account_record(id="creative-a", name="Creative A"))
        if not await session.get(User, "creative-a"):
            session.add(
                User(
                    id="creative-a",
                    username="creative-a",
                    username_normalized="creative-a",
                    password_hash="unused",
                )
            )
        await session.commit()
        author = CreativeCatalog(session, principal("creative-a", "creative-a"), settings=settings)
        unsafe = await author.create(
            CreativeDraftIn(
                kind="tool_api",
                title="Unsafe",
                summary="Unsafe",
                manifest={"method": "GET", "url": "https://example.com/api?token=hidden"},
            )
        )
        with pytest.raises(CreativeError):
            await author.publish(unsafe.id, unsafe.revision)
        bundle = await author.create(CreativeDraftIn(kind="bundle", title="Empty", summary="Empty"))
        with pytest.raises(CreativeError):
            await author.publish(bundle.id, bundle.revision)
        assert await session.scalar(select(CreativeItem).where(CreativeItem.id == bundle.id))
        private_skill = await author.create(
            CreativeDraftIn(kind="skill", title="Private Skill", summary="Must stay private")
        )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(
                "SKILL.md", "---\nname: private\ndescription: Private skill\n---\n# Private\n"
            )
            zipped.writestr(".env", "API_KEY=very-secret-value")
        private_skill = await author.upload_skill(
            private_skill.id,
            private_skill.revision,
            UploadFile(file=io.BytesIO(archive.getvalue()), filename="private.zip"),
        )
        with pytest.raises(CreativeFileError):
            await author.publish(private_skill.id, private_skill.revision)


@pytest.mark.asyncio
async def test_cover_upload_rechecks_revision_after_file_staging(monkeypatch):
    from sqlalchemy import update

    from studio.apps.creative_workshop import catalog as module

    owner = "creative-cover-cas"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        actor = principal(owner, owner)
        item = await CreativeCatalog(session, actor, settings=settings).create(
            CreativeDraftIn(kind="tool_api", title="cover", summary="test")
        )
        relative = "creative-workshop/covers/cas.webp"
        target = resolve_file(owner, relative, settings=settings)

        async def staged(_owner, _upload, *, settings=None):
            assert settings is isolated_settings
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"synthetic cover")
            async with SessionLocal() as other:
                await other.execute(
                    update(CreativeItem)
                    .where(CreativeItem.id == item.id)
                    .values(revision=CreativeItem.revision + 1)
                )
                await other.commit()
            return relative

        monkeypatch.setattr(module, "save_cover", staged)
        with pytest.raises(CreativeError) as error:
            await CreativeCatalog(session, actor, settings=settings).upload_cover(
                item.id, item.revision, None
            )
        assert error.value.code == "revision_conflict"
        assert not target.exists()
        refreshed = await session.get(CreativeItem, item.id)
        assert refreshed.revision == item.revision + 1
        assert refreshed.draft_cover_path == ""


@pytest.mark.asyncio
async def test_cover_commit_response_loss_preserves_committed_file(monkeypatch):
    from studio.apps.creative_workshop import catalog as module

    owner = "creative-cover-unknown"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        actor = principal(owner, owner)
        item = await CreativeCatalog(session, actor, settings=settings).create(
            CreativeDraftIn(kind="tool_api", title="cover", summary="test")
        )
        relative = "creative-workshop/covers/committed.webp"
        target = resolve_file(owner, relative, settings=settings)

        async def staged(_owner, _upload, *, settings=None):
            assert settings is isolated_settings
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"committed cover")
            return relative

        original_commit = session.commit

        async def lost_ack():
            await original_commit()
            raise RuntimeError("synthetic response loss")

        monkeypatch.setattr(module, "save_cover", staged)
        monkeypatch.setattr(session, "commit", lost_ack)
        with pytest.raises(RuntimeError, match="response loss"):
            await CreativeCatalog(session, actor, settings=settings).upload_cover(
                item.id, item.revision, None
            )
        assert target.read_bytes() == b"committed cover"
    async with SessionLocal() as session:
        row = await session.get(CreativeItem, item.id)
        assert row.draft_cover_path == relative
        assert row.revision == item.revision + 1


def test_creative_files_reject_symlink_paths(tmp_path):
    from types import SimpleNamespace

    outside = tmp_path / "outside"
    outside.mkdir()
    account = tmp_path / "accounts" / "owner"
    account.mkdir(parents=True)
    (account / "escape").symlink_to(outside, target_is_directory=True)
    settings = SimpleNamespace(runtime_path=tmp_path, account_path=lambda _owner: account)
    with pytest.raises(CreativeFileError, match="符号链接"):
        resolve_file("owner", "escape/file.webp", settings=settings)
    with pytest.raises(CreativeFileError, match="路径无效"):
        resolve_file("owner", "../outside/file.webp", settings=settings)


@pytest.mark.asyncio
async def test_skill_upload_commit_response_loss_keeps_committed_archive(monkeypatch):
    from studio.apps.creative_workshop import catalog as module

    owner = "creative-skill-unknown"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        actor = principal(owner, owner)
        item = await CreativeCatalog(session, actor, settings=settings).create(
            CreativeDraftIn(kind="skill", title="Skill", summary="test")
        )
        relative = f"creative-workshop/skill-drafts/{item.id}/draft"
        target = resolve_file(owner, relative, settings=settings)

        async def staged(_owner, _item_id, _upload, *, archive_parser, settings=None):
            del archive_parser
            assert settings is isolated_settings
            target.mkdir(parents=True, exist_ok=True)
            (target / "SKILL.md").write_text("# Synthetic Skill")
            return relative, {"name": "synthetic", "content_sha256": "a" * 64}

        original_commit = session.commit

        async def lost_ack():
            await original_commit()
            raise RuntimeError("synthetic response loss")

        monkeypatch.setattr(module, "save_skill_draft", staged)
        monkeypatch.setattr(session, "commit", lost_ack)
        with pytest.raises(RuntimeError, match="response loss"):
            await CreativeCatalog(session, actor, settings=settings).upload_skill(
                item.id, item.revision, None
            )
        assert (target / "SKILL.md").read_text() == "# Synthetic Skill"
    async with SessionLocal() as session:
        row = await session.get(CreativeItem, item.id)
        assert row.draft_skill_path == relative and row.revision == item.revision + 1


@pytest.mark.asyncio
async def test_publish_commit_response_loss_preserves_published_archive(monkeypatch):
    owner = "creative-publish-unknown"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        actor = principal(owner, owner)
        item = await CreativeCatalog(session, actor, settings=settings).create(
            CreativeDraftIn(kind="skill", title="Skill", summary="test")
        )
        relative = f"creative-workshop/skill-drafts/{item.id}/draft"
        target = resolve_file(owner, relative, settings=settings)
        target.mkdir(parents=True, exist_ok=True)
        (target / "SKILL.md").write_text("# Synthetic Skill")
        row = await session.get(CreativeItem, item.id)
        row.draft_skill_path = relative
        row.draft_manifest = {"name": "synthetic", "content_sha256": "a" * 64}
        await session.commit()
        original_commit = session.commit

        async def lost_ack():
            await original_commit()
            raise RuntimeError("synthetic response loss")

        monkeypatch.setattr(session, "commit", lost_ack)
        with pytest.raises(RuntimeError, match="response loss"):
            await CreativeCatalog(session, actor, settings=settings).publish(item.id, item.revision)
    async with SessionLocal() as session:
        row = await session.get(CreativeItem, item.id)
        assert row.status == "published" and row.revision == item.revision + 1
        release = await session.get(CreativeRelease, row.current_release_id)
        assert (
            resolve_file(owner, release.skill_path, settings=settings) / "SKILL.md"
        ).read_text() == "# Synthetic Skill"


@pytest.mark.asyncio
async def test_import_skill_owns_snapshot_after_source_removed():
    from studio.config.settings import get_settings

    owner = "creative-skill-source"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        skill = SkillIntegration(
            id="source-skill", owner_user_id=owner, name="Owned", description="demo"
        )
        session.add(skill)
        await session.flush()
        session.add(
            SkillVersion(
                skill_id=skill.id,
                version="v1",
                name="Owned",
                storage_path="owned",
                content_sha256="a" * 64,
                file_count=1,
                expanded_bytes=64,
            )
        )
        await session.commit()
        original = get_settings().account_skill_path(owner) / "source-skill" / "v1"
        original.mkdir(parents=True, exist_ok=True)
        (original / "SKILL.md").write_text("---\nname: owned\ndescription: demo\n---\n# Owned\n")
        actor = principal(owner, owner)
        result = await CreativeCatalog(session, actor, settings=settings).import_source(
            "skill", "source-skill"
        )
        row = await session.get(CreativeItem, result.id)
        assert row.draft_skill_path.startswith("creative-workshop/skill-drafts/")
        copied = resolve_file(owner, row.draft_skill_path, settings=settings) / "SKILL.md"
        assert copied.read_bytes() == (original / "SKILL.md").read_bytes()
        shutil.rmtree(original)
        published = await CreativeCatalog(session, actor, settings=settings).publish(
            result.id, result.revision
        )
        assert published.status == "published"
        assert copied.is_file()


@pytest.mark.asyncio
async def test_import_source_rejects_another_accounts_integration():
    owner, foreign = "creative-source-owner", "creative-source-foreign"
    async with SessionLocal() as session:
        session.add_all(
            [account_record(id=owner, name=owner), account_record(id=foreign, name=foreign)]
        )
        session.add(
            ToolApiIntegration(
                id="foreign-source",
                owner_user_id=foreign,
                name="Hidden",
                method="GET",
                url="https://example.com",
            )
        )
        await session.commit()
        with pytest.raises(CreativeError) as error:
            await CreativeCatalog(
                session, principal(owner, owner), settings=settings
            ).import_source("tool_api", "foreign-source")
        assert error.value.status == 404


@pytest.mark.asyncio
async def test_import_skill_rejects_bad_source_digest():
    from studio.apps.creative_workshop.catalog_sources import CreativeSource

    class Sources:
        async def snapshot(self, *, owner, kind, source_id):
            assert owner == "creative-source-digest" and kind == "skill" and source_id == "x"
            return CreativeSource("Skill", "demo", {}, b"not the declared bytes", "a" * 64)

    owner = "creative-source-digest"
    async with SessionLocal() as session:
        session.add(account_record(id=owner, name=owner))
        await session.commit()
        with pytest.raises(CreativeError, match="摘要不匹配"):
            await CreativeCatalog(
                session, principal(owner, owner), sources=Sources(), settings=settings
            ).import_source("skill", "x")
        assert (
            list(
                (
                    await session.scalars(
                        select(CreativeItem).where(CreativeItem.origin_owner_user_id == owner)
                    )
                ).all()
            )
            == []
        )


def test_publish_skill_rejects_symlink_directory(tmp_path):
    from types import SimpleNamespace

    from studio.apps.creative_workshop.storage import catalog_files as files

    account = tmp_path / "accounts" / "owner"
    source = account / "creative-workshop" / "skill-drafts" / "draft"
    source.mkdir(parents=True)
    (source / "SKILL.md").write_text("# Synthetic")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "private.txt").write_text("not for publication")
    (source / "linked-directory").symlink_to(outside, target_is_directory=True)
    settings = SimpleNamespace(runtime_path=tmp_path, account_path=lambda _owner: account)
    with pytest.raises(CreativeFileError, match="符号链接"):
        files.copy_skill_release(
            "owner", "creative-workshop/skill-drafts/draft", "release", settings=settings
        )
    assert not (account / "creative-workshop" / "skill-releases" / "release").exists()
