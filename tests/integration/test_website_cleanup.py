"""Temporary cleanup retains unique originals and revalidates durable asset associations."""

import json

import pytest
from scripts.website import cleanup


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".local/old-render").mkdir(parents=True)
    canonical = tmp_path / ".runtime/accounts/owner/library/assets/asset.png"
    canonical.parent.mkdir(parents=True)
    canonical.write_bytes(b"canonical image")
    (tmp_path / ".local/old-render/duplicate.png").write_bytes(canonical.read_bytes())
    (tmp_path / ".local/old-render/unique.png").write_bytes(b"unique creative original")
    (tmp_path / ".local/old-render/__pycache__").mkdir()
    (tmp_path / ".local/old-render/__pycache__/module.pyc").write_bytes(b"cache")
    protected = tmp_path / ".local/agent-workbench"
    protected.mkdir()
    (protected / "active.png").write_bytes(canonical.read_bytes())
    monkeypatch.setattr(cleanup, "ROOT", tmp_path)
    monkeypatch.setattr(cleanup, "active_local_roots", lambda _root: set())
    monkeypatch.setattr(
        cleanup,
        "registered_assets",
        lambda _root: {
            canonical: {"asset_id": "asset", "owner_user_id": "owner"},
        },
    )
    return tmp_path, canonical


def test_only_verified_duplicates_and_reproducible_caches_are_removed(project):
    root, _ = project
    manifest = cleanup.plan(root)
    assert len(manifest["entries"]) == 2
    cleanup.apply(manifest, root / "result.json")
    assert not (root / ".local/old-render/duplicate.png").exists()
    assert not (root / ".local/old-render/__pycache__").exists()
    assert (root / ".local/old-render/unique.png").exists()
    assert (root / ".local/agent-workbench/active.png").exists()
    assert json.loads((root / "result.json").read_text())["released_logical_bytes"] > 0


def test_changed_durable_copy_stops_cleanup(project):
    root, canonical = project
    manifest = cleanup.plan(root)
    canonical.write_bytes(b"changed")
    with pytest.raises(ValueError, match="已变化"):
        cleanup.apply(manifest, root / "result.json")
    assert (root / ".local/old-render/duplicate.png").exists()


def test_cleanup_manifest_cannot_escape_the_temporary_tree(project):
    root, _ = project
    outside = root / "keep.png"
    outside.write_bytes(b"keep")
    manifest = {
        "root": str(root),
        "protected": [],
        "entries": [{"path": "keep.png", "kind": "duplicate"}],
    }
    with pytest.raises(ValueError, match="非法清理目标"):
        cleanup.apply(manifest, root / "result.json")
    assert outside.read_bytes() == b"keep"
