"""Conversation file adapters never infer deployment roots from global settings."""

import pytest

from studio.apps.amadeus.storage.files import list_files, read_file_bytes, work_root, write_file
from studio.runtime.database.operation_receipts import OperationError
from website_test_support import app


def test_explicit_roots_and_accounts_are_independent(tmp_path, monkeypatch):
    from studio.config import settings

    def forbidden():
        raise AssertionError("Storage attempted to read global deployment settings")

    monkeypatch.setattr(settings, "get_settings", forbidden)
    first, second = tmp_path / "first", tmp_path / "second"
    saved = write_file(
        "alice", "conversation", "imports", "notes.txt", b"first", "", files_root=first
    )
    assert (
        read_file_bytes("alice", "conversation", "imports", "notes.txt", files_root=first)
        == b"first"
    )
    assert list_files("alice", "conversation", files_root=second) == []
    assert list_files("bob", "conversation", files_root=first) == []
    with pytest.raises(OperationError) as conflict:
        write_file(
            "alice", "conversation", "imports", "notes.txt", b"overwrite", "", files_root=first
        )
    assert conflict.value.code == "revision_conflict"
    write_file(
        "alice",
        "conversation",
        "imports",
        "notes.txt",
        b"second",
        saved["sha256"],
        files_root=first,
    )
    with pytest.raises(TypeError):
        work_root("alice", "conversation")
    with pytest.raises(OperationError):
        work_root("../bob", "conversation", files_root=first)


async def test_website_skill_load_uses_its_injected_catalog(tmp_path, monkeypatch):
    from dataclasses import replace
    from types import SimpleNamespace

    import httpx
    from tests.test_amadeus import _test_user

    source = tmp_path / "skill-source"
    source.mkdir()
    (source / "SKILL.md").write_text("# Controlled fixture")

    class Catalog:
        storage = SimpleNamespace(final_path=lambda _id, _version: source)

        async def get(self, identity):
            assert identity == "fixture-skill"
            return SimpleNamespace(
                enabled=True, default_version="v1", latest_version="v1", name="Fixture"
            )

        async def versions(self, _identity):
            return [SimpleNamespace(version="v1")]

    owners = []

    def catalog(_request, session, owner):
        assert session.info["owner_user_id"] == owner
        owners.append(owner)
        return Catalog()

    monkeypatch.setattr(
        app.state, "integration_bindings", replace(app.state.integration_bindings, skills=catalog)
    )
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()["id"]
        prefix = f"/v1/amadeus/conversations/{conversation}/skills/fixture-skill"
        loaded = await client.post(prefix + "/load")
        assert loaded.status_code == 200, loaded.text
        assert loaded.json()["version"] == "v1"
        original = await client.get(prefix + "/v1/files/SKILL.md")
        assert original.status_code == 200, original.text
        assert original.json()["content"] == "# Controlled fixture"
    assert owners == ["test-user"]
