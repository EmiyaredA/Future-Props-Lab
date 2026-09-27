from __future__ import annotations

import io
import shutil
import zipfile

import pytest
from fastapi import UploadFile
from sqlalchemy import select

from app.capabilities.identity.principal import StudioPrincipal
from app.console.creative_workshop.catalog import CreativeCatalog, CreativeError
from app.console.creative_workshop.files import CreativeFileError, resolve_file
from app.console.creative_workshop.install import CreativeInstaller
from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from app.console.creative_workshop.schemas import (
    CreativeDraftIn,
    CreativeDraftUpdateIn,
    CreativeInstallPreviewIn,
    CreativeStdioSetupIn,
)
from app.console.models import User, Workspace
from app.integrations.models import McpIntegration, ToolApiIntegration
from app.runtime.db import SessionLocal


def principal(user_id: str, workspace_id: str, role: str = "admin") -> StudioPrincipal:
    return StudioPrincipal(
        user_id=user_id,
        workspace_id=workspace_id,
        workspace_access="member",
        member_role=role,
        is_platform_admin=False,
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )


@pytest.mark.asyncio
async def test_cross_workspace_public_catalog_and_atomic_install() -> None:
    async with SessionLocal() as session:
        session.add_all(
            [
                Workspace(id="creative-a", name="Creative A"),
                Workspace(id="creative-b", name="Creative B"),
                Workspace(id="creative-c", name="Creative C"),
                User(
                    id="creative-user-a",
                    username="creative-a",
                    username_normalized="creative-a",
                    password_hash="unused",
                ),
                User(
                    id="creative-user-b",
                    username="creative-b",
                    username_normalized="creative-b",
                    password_hash="unused",
                ),
                User(
                    id="creative-user-c",
                    username="creative-c",
                    username_normalized="creative-c",
                    password_hash="unused",
                ),
            ]
        )
        await session.commit()
        author = CreativeCatalog(session, principal("creative-user-a", "creative-a", "member"))
        viewer = CreativeCatalog(session, principal("creative-user-b", "creative-b"))
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
        assert public.items[0].origin_workspace_id == "creative-a"
        assert "secret" not in str(public.items[0].manifest).lower()
        assert public.items[0].current_release_id == published.current_release_id
        session.add(
            ToolApiIntegration(
                id="creative-private-source",
                workspace_id="creative-a",
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
            session,
            principal("creative-user-a", "creative-a", "admin"),
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
        with pytest.raises(CreativeError) as denied:
            await CreativeInstaller(
                session, principal("creative-user-a", "creative-a", "member")
            ).preview(CreativeInstallPreviewIn(release_id=bundle.current_release_id))
        assert denied.value.status == 403
        installer = CreativeInstaller(session, principal("creative-user-b", "creative-b"))
        install_body = CreativeInstallPreviewIn(release_id=bundle.current_release_id)
        preview = await installer.preview(install_body)
        assert preview.installable and len(preview.parts) == 1
        installed = await installer.install(install_body)
        assert len(installed.resources) == 1
        assert (await installer.install(install_body)).already_installed
        row = await session.scalar(
            select(ToolApiIntegration).where(ToolApiIntegration.workspace_id == "creative-b")
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
            select(McpIntegration).where(McpIntegration.workspace_id == "creative-b")
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
        shutil.rmtree(resolve_file("creative-a", skill_release.skill_path))
        other_installer = CreativeInstaller(session, principal("creative-user-c", "creative-c"))
        with pytest.raises(CreativeError):
            await other_installer.install(
                CreativeInstallPreviewIn(
                    release_id=broken_bundle.current_release_id,
                )
            )
        assert (
            await session.scalar(
                select(ToolApiIntegration).where(ToolApiIntegration.workspace_id == "creative-c")
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
        if not await session.get(Workspace, "creative-a"):
            session.add(Workspace(id="creative-a", name="Creative A"))
        if not await session.get(User, "creative-user-a"):
            session.add(
                User(
                    id="creative-user-a",
                    username="creative-a",
                    username_normalized="creative-a",
                    password_hash="unused",
                )
            )
        await session.commit()
        author = CreativeCatalog(session, principal("creative-user-a", "creative-a"))
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
