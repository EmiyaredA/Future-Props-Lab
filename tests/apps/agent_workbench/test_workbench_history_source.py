"""Native file reading keeps session ownership and project authorization separate."""

from contextlib import aclosing
from types import SimpleNamespace
from uuid import uuid4

import pytest

from studio.apps.agent_workbench.execution import project_files
from studio.apps.agent_workbench.storage.models import WorkbenchSession
from studio.apps.identity.storage import cloud_access as access
from studio.config.settings import CloudProject, get_settings
from tests.apps.remote_desktop.test_cloud_control import WORKBENCH, admin_client, configure, unlock
from website_test_support import SessionLocal

pytestmark = pytest.mark.real_auth


async def test_history_source_requires_project_authorization_and_current_unlock(
    monkeypatch, tmp_path
):
    client, owner = await admin_client()
    other, other_owner = await admin_client()
    remote, remote_owner = await admin_client(local=False)
    configure(monkeypatch, owner, other_owner, remote_owner)
    root = (tmp_path / "project").resolve()
    root.mkdir()
    (root / "sample.py").write_text("print('current file')\n")
    (root / "config.toml").write_text("private")
    (root / "big.txt").write_bytes(b"x" * (project_files.MAX_FILE_BYTES + 1))
    (root / "binary.txt").write_bytes(b"\xff\x00")
    outside = tmp_path / "outside.txt"
    outside.write_text("private")
    (root / "link.txt").symlink_to(outside)
    identities = []
    async with SessionLocal() as db:
        for account in (owner, remote_owner):
            identity = str(uuid4())
            db.add(
                WorkbenchSession(
                    id=identity,
                    owner_user_id=account,
                    agent_id="codex",
                    native_id=identity,
                    cwd=str(root),
                )
            )
            identities.append(identity)
        await db.commit()
    url = f"{WORKBENCH}/sessions/{identities[0]}/source"
    async with aclosing(client), aclosing(other), aclosing(remote):
        await unlock(client)
        await unlock(other)
        # A native log claiming a cwd does not itself grant filesystem access.
        assert (await client.get(url, params={"path": "sample.py"})).status_code == 403
        registered = await client.post(WORKBENCH + "/execution/projects", json={"root": str(root)})
        assert registered.status_code == 200, registered.text
        result = await client.get(url, params={"path": str(root / "sample.py"), "line": 1})
        assert result.status_code == 200, result.text
        assert result.headers["cache-control"] == "no-store"
        assert result.json()["text"] == "print('current file')\n"
        assert result.json()["path"] == "sample.py" and result.json()["line"] == 1
        assert (await other.get(url, params={"path": "sample.py"})).status_code == 404
        for path in (
            "../outside.txt",
            str(outside),
            ".env",
            "config.toml",
            "link.txt",
            "missing.txt",
            "big.txt",
            "binary.txt",
        ):
            assert (await client.get(url, params={"path": path})).status_code == 404, path
        assert (await client.get(url, params={"path": "sample.py", "line": 0})).status_code == 422
        # The public entry cannot inherit a local directory registration.
        remote_url = f"{WORKBENCH}/sessions/{identities[1]}/source"
        assert (await remote.get(remote_url, params={"path": "sample.py"})).status_code == 403
        monkeypatch.setattr(
            get_settings(),
            "fpl_cloud_control_projects",
            {"fixture": CloudProject(label="Fixture", root=str(root), user_ids=[owner])},
        )
        assert (await remote.get(remote_url, params={"path": "sample.py"})).status_code == 403
        remote.cookies = client.cookies
        remote.headers["X-CSRF-Token"] = client.cookies["fpl_csrf"]
        monkeypatch.setattr(get_settings(), "fpl_cloud_control_public_desktop_vnc_only", False)
        await unlock(remote)
        assert (await remote.get(url, params={"path": "sample.py"})).status_code == 200
        original_read = project_files.read_file

        def revoke_during_read(*args, **kwargs):
            content = original_read(*args, **kwargs)
            monkeypatch.setattr(get_settings(), "fpl_cloud_control_projects", {})
            return content

        monkeypatch.setattr(project_files, "read_file", revoke_during_read)
        assert (await remote.get(url, params={"path": "sample.py"})).status_code == 404
        monkeypatch.setattr(project_files, "read_file", original_read)
        now = access.time.time()
        monkeypatch.setattr(access, "time", SimpleNamespace(time=lambda: now + 3600))
        assert (await client.get(url, params={"path": "sample.py"})).status_code == 403
