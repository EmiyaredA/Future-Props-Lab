from __future__ import annotations

import io
import zipfile
from uuid import uuid4

import httpx
import pytest

from app.capabilities.identity.principal import StudioPrincipal
from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_workspace
from app.runtime.config import get_settings


def skill_zip(name: str, description: str = "Tag fixture") -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(
            "SKILL.md", f"---\nname: {name}\ndescription: {description}\n---\n# Skill\n"
        )
        archive.writestr("references/guide.txt", "Keep original reference")
    return stream.getvalue()


@pytest.mark.asyncio
async def test_tags_import_edit_clear_and_version_preservation():
    name = f"tags-{uuid4().hex}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/integrations/skills",
            files={"file": ("skill.zip", skill_zip(name), "application/zip")},
            data={"enabled": "true", "tags": [" MiniMax H3 ", "", "视频生成", "MiniMax H3"]},
        )
        assert created.status_code == 201, created.text
        current = created.json()
        assert current["tags"] == ["MiniMax H3", "视频生成"]
        path = f"/v1/integrations/skills/{current['id']}"
        assert (await client.get(path)).json()["tags"] == current["tags"]
        assert (
            next(
                row
                for row in (await client.get("/v1/integrations/skills")).json()["items"]
                if row["id"] == current["id"]
            )["tags"]
            == current["tags"]
        )
        original = (await client.get(path + "/versions/v1/content")).content
        edit = {
            "expected_revision": current["revision"],
            "enabled": True,
            "default_version": "v1",
            "tags": [" 广告 ", "广告"],
        }
        changed = await client.patch(path, json=edit)
        assert changed.status_code == 200, changed.text
        current = changed.json()
        assert current["tags"] == ["广告"]
        assert current["version_count"] == 1
        assert (await client.get(path + "/versions/v1/content")).content == original
        conflict = await client.patch(path, json=edit)
        assert conflict.status_code == 409
        assert "广告" in conflict.text
        missing_revision = await client.patch(
            path, json={"enabled": True, "default_version": "v1", "tags": []}
        )
        assert missing_revision.status_code == 422
        omitted = await client.patch(
            path,
            json={
                "expected_revision": current["revision"],
                "enabled": False,
                "default_version": "v1",
            },
        )
        current = omitted.json()
        assert current["tags"] == ["广告"] and not current["enabled"]
        added = await client.post(
            path + "/versions",
            files={"file": ("skill.zip", skill_zip(name, "Second version"), "application/zip")},
            data={"expected_revision": str(current["revision"])},
        )
        assert added.status_code == 200, added.text
        current = added.json()
        assert current["tags"] == ["广告"] and current["version_count"] == 2
        switched = await client.patch(
            path,
            json={
                "expected_revision": current["revision"],
                "enabled": True,
                "default_version": "v2",
            },
        )
        current = switched.json()
        assert current["tags"] == ["广告"] and current["default_version"] == "v2"
        cleared = await client.patch(
            path,
            json={
                "expected_revision": current["revision"],
                "enabled": True,
                "default_version": "v2",
                "tags": [],
            },
        )
        assert cleared.status_code == 200
        assert cleared.json()["tags"] == []
        assert (
            await client.delete(path, params={"expected_revision": cleared.json()["revision"]})
        ).status_code == 200


@pytest.mark.asyncio
async def test_tag_limits_and_legacy_upload():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        files = {"file": ("skill.zip", skill_zip(f"limit-{uuid4().hex}"), "application/zip")}
        rejected = await client.post(
            "/v1/integrations/skills", files=files, data={"tags": [str(i) for i in range(13)]}
        )
        assert rejected.status_code == 422, rejected.text
        created = await client.post("/v1/integrations/skills", files=files)
        assert created.status_code == 201, created.text
        current = created.json()
        assert current["tags"] == []
        path = f"/v1/integrations/skills/{current['id']}"
        body = {"expected_revision": current["revision"], "enabled": False, "default_version": "v1"}
        for tags in ([str(i) for i in range(13)], None, "not-an-array", [7]):
            assert (await client.patch(path, json={**body, "tags": tags})).status_code == 422
        accepted = await client.patch(path, json={**body, "tags": [str(i) for i in range(12)]})
        assert accepted.status_code == 200
        assert len(accepted.json()["tags"]) == 12
        await client.delete(path, params={"expected_revision": accepted.json()["revision"]})


@pytest.mark.asyncio
async def test_skill_tags_workspace_isolation_and_member_permissions():
    workspace = "default"
    role = "owner"

    async def principal(session: SessionDep) -> StudioPrincipal:
        bind_workspace(session, workspace)
        return StudioPrincipal(
            user_id="fixture",
            workspace_id=workspace,
            membership_id="fixture",
            workspace_access=role,
            member_role=role,
            is_platform_admin=False,
            must_change_password=False,
            auth_kind="session",
            session_id="fixture",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
        )

    previous = app.dependency_overrides.get(require_studio_auth)
    app.dependency_overrides[require_studio_auth] = principal
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            created = await client.post(
                "/v1/integrations/skills",
                files={
                    "file": ("skill.zip", skill_zip(f"private-{uuid4().hex}"), "application/zip")
                },
                data={"tags": ["private-tag"]},
            )
            assert created.status_code == 201, created.text
            current = created.json()
            path = f"/v1/integrations/skills/{current['id']}"
            storage = (
                get_settings().workspace_skill_path(workspace) / current["id"] / "v1" / "SKILL.md"
            )
            assert storage.is_file()
            body = {
                "expected_revision": current["revision"],
                "enabled": True,
                "default_version": "v1",
                "tags": ["changed"],
            }
            role = "member"
            assert (await client.get(path)).status_code == 200
            assert (await client.patch(path, json=body)).status_code == 403
            assert (
                await client.post(
                    "/v1/integrations/skills",
                    files={"file": ("new.zip", skill_zip("forbidden"), "application/zip")},
                )
            ).status_code == 403
            role = "owner"
            workspace = "other-tags-workspace"
            assert (await client.get("/v1/integrations/skills")).json()["items"] == []
            for suffix in ("", "/versions", "/versions/v1/content"):
                assert (await client.get(path + suffix)).status_code == 404
            assert (await client.patch(path, json=body)).status_code == 404
            workspace = "default"
            assert (await client.get(path)).json()["tags"] == ["private-tag"]
            assert (
                await client.delete(path, params={"expected_revision": current["revision"]})
            ).status_code == 200
    finally:
        if previous is None:
            app.dependency_overrides.pop(require_studio_auth, None)
        else:
            app.dependency_overrides[require_studio_auth] = previous
