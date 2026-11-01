import plistlib
import subprocess
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest

from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.tool_navigation import storage_usage as storage
from app.tool_navigation import storage_usage_routes as routes


def analyzer(tmp_path, monkeypatch, *, identifier=storage.BUNDLE_ID):
    bundle = tmp_path / "GrandPerspective.app"
    binary = bundle / "Contents/MacOS/GrandPerspective"
    binary.parent.mkdir(parents=True)
    binary.write_text("test binary, never executed")
    binary.chmod(0o700)
    (bundle / "Contents/Info.plist").write_bytes(
        plistlib.dumps(
            {
                "CFBundleIdentifier": identifier,
                "CFBundleShortVersionString": "3.8.1",
                "CFBundleExecutable": binary.name,
            }
        )
    )
    monkeypatch.setattr(storage, "application_candidates", lambda: (bundle,))
    return bundle


def test_analyzer_requires_matching_bundle_version_and_executable(tmp_path, monkeypatch):
    bundle = analyzer(tmp_path, monkeypatch)
    assert storage.find_analyzer()[1].version == "3.8.1"
    binary = bundle / "Contents/MacOS/GrandPerspective"
    binary.chmod(0o600)
    assert not storage.find_analyzer()[1].installed
    binary.chmod(0o700)
    plist = bundle / "Contents/Info.plist"
    info = plistlib.loads(plist.read_bytes())
    for field, value in (
        ("CFBundleIdentifier", "wrong"),
        ("CFBundleShortVersionString", ""),
        ("CFBundleExecutable", "../../other"),
    ):
        plist.write_bytes(plistlib.dumps({**info, field: value}))
        assert not storage.find_analyzer()[1].installed
    plist.write_bytes(b"not a plist")
    assert not storage.find_analyzer()[1].installed
    plist.write_bytes(b'<?xml version="1.0"?><plist><dict>')
    assert not storage.find_analyzer()[1].installed


def test_capacity_reads_selected_volume_without_scanning(tmp_path, monkeypatch):
    analyzer(tmp_path, monkeypatch)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    usage = Mock(total=1000, used=600, free=400)
    disk_usage = Mock(return_value=usage)
    monkeypatch.setattr(storage.shutil, "disk_usage", disk_usage)
    result = storage.read_storage_usage(str(tmp_path))
    disk_usage.assert_called_once_with(tmp_path.resolve())
    assert result.capacity.model_dump() == {
        "total_bytes": 1000,
        "used_bytes": 600,
        "free_bytes": 400,
    }
    assert result.analyzer.installed
    assert not next(s for s in result.shortcuts if s.id == "downloads").available


@pytest.mark.parametrize("value", ["relative", "", "file:///tmp", "\0"])
def test_invalid_directory_rejected(value):
    with pytest.raises(storage.StorageUsageError):
        storage.checked_directory(value)


def test_missing_file_and_unreadable_directories(tmp_path, monkeypatch):
    with pytest.raises(storage.StorageUsageError, match="不存在"):
        storage.checked_directory(str(tmp_path / "missing"))
    file = tmp_path / "file"
    file.touch()
    with pytest.raises(storage.StorageUsageError, match="不是目录"):
        storage.checked_directory(str(file))
    monkeypatch.setattr(storage.os, "access", lambda *_: False)
    with pytest.raises(storage.StorageUsageError, match="权限"):
        storage.checked_directory(str(tmp_path))


def test_open_passes_unicode_and_shell_characters_as_literal_arguments(tmp_path, monkeypatch):
    bundle = analyzer(tmp_path, monkeypatch)
    selected = tmp_path / "中文 目录;$(touch nope)`echo`"
    selected.mkdir()
    link = tmp_path / "alias"
    link.symlink_to(selected, target_is_directory=True)
    run = Mock()
    monkeypatch.setattr(storage.subprocess, "run", run)
    receipt = storage.open_storage_directory(str(link), analyze=True)
    assert receipt.directory == str(selected.resolve())
    run.assert_called_once_with(
        ["/usr/bin/open", "-a", str(bundle.resolve()), str(selected.resolve())],
        check=True,
        timeout=10,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    run.reset_mock()
    storage.open_storage_directory(str(selected), analyze=False)
    assert run.call_args.args[0] == [
        "/usr/bin/open",
        "-b",
        "com.apple.finder",
        str(selected.resolve()),
    ]
    assert not (tmp_path / "nope").exists()


@pytest.mark.parametrize(
    "failure",
    [OSError(), subprocess.CalledProcessError(1, "open"), subprocess.TimeoutExpired("open", 10)],
)
def test_open_failure_never_retries(tmp_path, monkeypatch, failure):
    run = Mock(side_effect=failure)
    monkeypatch.setattr(storage.subprocess, "run", run)
    with pytest.raises(storage.StorageUsageError):
        storage.open_storage_directory(str(tmp_path), analyze=False)
    assert run.call_count == 1


def test_missing_analyzer_and_capacity_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "application_candidates", lambda: ())
    run = Mock()
    monkeypatch.setattr(storage.subprocess, "run", run)
    with pytest.raises(storage.StorageUsageError, match="GrandPerspective"):
        storage.open_storage_directory(str(tmp_path), analyze=True)
    run.assert_not_called()
    monkeypatch.setattr(storage.shutil, "disk_usage", Mock(side_effect=OSError()))
    with pytest.raises(storage.StorageUsageError, match="容量"):
        storage.read_storage_usage(str(tmp_path))


@pytest.mark.asyncio
async def test_api_desktop_mac_session_and_admin_guards(tmp_path, monkeypatch):
    analyzer(tmp_path, monkeypatch)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(routes.sys, "platform", "darwin")
    run = Mock()
    monkeypatch.setattr(storage.subprocess, "run", run)
    base = "/v1/tool-navigation/storage-usage"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get(base)).status_code == 403
        from fastapi import HTTPException

        def local_session(_request, principal):
            if principal.auth_kind != "session":
                raise HTTPException(403)

        monkeypatch.setattr(routes, "require_local_browser", local_session)
        assert (await client.get(base)).json()["analyzer"]["version"] == "3.8.1"
        for suffix in ("/analyze", "/open-directory"):
            response = await client.post(base + suffix, json={"directory": str(tmp_path)})
            assert response.status_code == 200
            assert response.json()["submitted"]
            assert (
                await client.post(base + suffix, json={"directory": "relative"})
            ).status_code == 422
        assert (
            await client.get(base, params={"directory": "/missing-storage-test"})
        ).status_code == 422
        original = app.dependency_overrides[require_studio_auth]

        def denied_principal(changes):
            async def denied(session: SessionDep):
                return replace(await original(session), **changes)

            return denied

        for change in ({"platform_role": "user"}, {"auth_kind": "management_api_key"}):
            app.dependency_overrides[require_studio_auth] = denied_principal(change)
            try:
                assert (await client.get(base)).status_code == 403
                for suffix in ("/analyze", "/open-directory"):
                    assert (
                        await client.post(base + suffix, json={"directory": str(tmp_path)})
                    ).status_code == 403
            finally:
                app.dependency_overrides[require_studio_auth] = original
        monkeypatch.setattr(routes.sys, "platform", "linux")
        assert (await client.get(base)).status_code == 404
    assert run.call_count == 2


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_api_requires_login():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/v1/tool-navigation/storage-usage")).status_code == 401


def test_storage_operations_are_not_agent_allowlisted():
    import json

    allowlist = json.loads(
        (
            Path(__file__).parents[1] / "backend/app/console/governance/automation_operations.json"
        ).read_text()
    )
    assert not any("/tool-navigation/storage-usage" in key for key in allowlist["operations"])
