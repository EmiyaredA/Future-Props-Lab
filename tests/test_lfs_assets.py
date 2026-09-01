from __future__ import annotations

import hashlib

from scripts.check_lfs_assets import asset_digest, check_asset_manifest


def test_asset_digest_accepts_materialized_files_and_lfs_pointer_oids(tmp_path) -> None:
    materialized = tmp_path / "image.png"
    materialized.write_bytes(b"deterministic image")
    assert asset_digest(materialized) == hashlib.sha256(b"deterministic image").hexdigest()

    oid = "a" * 64
    pointer = tmp_path / "pointer.png"
    pointer.write_text(
        f"version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 123\n",
        encoding="utf-8",
    )
    assert asset_digest(pointer) == oid


def test_documentation_asset_manifest_matches_repository_content() -> None:
    check_asset_manifest()
