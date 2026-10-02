import hashlib
from pathlib import Path

import pytest
from scripts import check_lfs_assets as assets


def test_runtime_asset_digest_mismatch_is_not_reported_as_missing(tmp_path, monkeypatch):
    relative = Path("asset.png")
    (tmp_path / relative).write_bytes(b"current bytes")
    monkeypatch.setattr(assets, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        assets, "EXPECTED_SHA256", {relative: hashlib.sha256(b"old bytes").hexdigest()}
    )
    with pytest.raises(SystemExit) as captured:
        assets.require_materialized((relative,), "asset.png")
    assert "SHA256" in str(captured.value)
    assert "git lfs pull" not in str(captured.value)


def test_missing_or_pointer_asset_has_materialization_instructions(tmp_path, monkeypatch):
    relative = Path("asset.png")
    monkeypatch.setattr(assets, "REPO_ROOT", tmp_path)
    for content in [None, assets.LFS_POINTER_PREFIX + b"oid sha256:test\n"]:
        if content:
            (tmp_path / relative).write_bytes(content)
        with pytest.raises(SystemExit) as captured:
            assets.require_materialized((relative,), "asset.png")
        assert "git lfs pull" in str(captured.value)
