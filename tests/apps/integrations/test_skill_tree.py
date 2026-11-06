"""The Skill tree digest binds names and contents, not ZIP container metadata."""

import io
import zipfile

import pytest

from studio.runtime.files.skill_tree import skill_tree_sha256


def extract(root, *, reverse=False, change=False):
    files = [
        ("SKILL.md", b"frontmatter"),
        ("nested/data.txt", b"changed" if change else b"original"),
    ]
    buffer = io.BytesIO()
    with zipfile.ZipFile(
        buffer, "w", compression=zipfile.ZIP_DEFLATED if reverse else zipfile.ZIP_STORED
    ) as archive:
        for name, contents in reversed(files) if reverse else files:
            archive.writestr(name, contents)
    root.mkdir()
    with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive:
        archive.extractall(root)
    return buffer.getvalue()


def test_tree_digest_ignores_zip_order_and_compression_but_binds_content_and_paths(tmp_path):
    first, second, changed = (tmp_path / name for name in ("first", "second", "changed"))
    a = extract(first)
    b = extract(second, reverse=True)
    extract(changed, change=True)
    options = {"max_files": 10, "max_bytes": 1000}
    assert a != b
    assert skill_tree_sha256(first, **options) == skill_tree_sha256(second, **options)
    assert skill_tree_sha256(first, **options) != skill_tree_sha256(changed, **options)
    (second / "nested/data.txt").rename(second / "nested/renamed.txt")
    assert skill_tree_sha256(first, **options) != skill_tree_sha256(second, **options)


def test_tree_digest_rejects_symlinks_and_limits(tmp_path):
    root = tmp_path / "tree"
    extract(root)
    with pytest.raises(ValueError, match="数量"):
        skill_tree_sha256(root, max_files=1, max_bytes=1000)
    with pytest.raises(ValueError, match="大小"):
        skill_tree_sha256(root, max_files=10, max_bytes=1)
    (root / "nested" / "link").symlink_to(root / "SKILL.md")
    with pytest.raises((ValueError, OSError)):
        skill_tree_sha256(root, max_files=10, max_bytes=1000)


async def test_published_source_rejects_other_release_paths_and_symlinked_account(tmp_path):
    from studio.apps.creative_workshop.skill_integrity import published_skill_tree

    target = tmp_path / "outside"
    target.mkdir()
    (tmp_path / "accounts").mkdir()
    (tmp_path / "accounts" / "author").symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="符号链接"):
        await published_skill_tree(
            tmp_path, "author", "release", "creative-workshop/skill-releases/release"
        )
    with pytest.raises(ValueError, match="路径"):
        await published_skill_tree(
            tmp_path, "author", "release", "creative-workshop/skill-releases/other"
        )
