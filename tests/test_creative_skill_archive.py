"""Published Skill ZIPs are deterministic, bounded and account-scoped."""

import asyncio
import io
import os
import threading
import zipfile
from contextlib import suppress

import pytest

from fpl_creative.skill_archive import SkillArchivePacker


async def test_repack_is_stable_and_binds_published_files(tmp_path):
    root = tmp_path / "accounts/author/creative-workshop/skill-releases/release"
    root.mkdir(parents=True)
    (root / "SKILL.md").write_text("---\nname: sample\ndescription: Test\n---\n")
    (root / "nested").mkdir()
    (root / "nested/data.txt").write_text("public data")
    packer = SkillArchivePacker(
        root=tmp_path, max_files=10, max_expanded_bytes=1000, max_archive_bytes=5000
    )
    relative = "creative-workshop/skill-releases/release"
    async with packer.open_release("author", "release", relative) as (stream, first):
        first_bytes = stream.read()
    os.utime(root / "SKILL.md", (1234567890, 1234567890))
    async with packer.open_release("author", "release", relative) as (stream, second):
        second_bytes = stream.read()
    assert first == second and first_bytes == second_bytes
    assert first.file_count == 2 and first.byte_size == len(first_bytes)
    with zipfile.ZipFile(io.BytesIO(first_bytes)) as archive:
        assert archive.read("nested/data.txt") == b"public data"
        assert archive.namelist() == ["SKILL.md", "nested/data.txt"]
    (root / "nested/data.txt").write_text("changed")
    async with packer.open_release("author", "release", relative) as (_, changed):
        assert changed.tree_sha256 != first.tree_sha256 and changed.sha256 != first.sha256
    with pytest.raises(ValueError):
        async with packer.open_release("other", "release", relative):
            pass
    (root / "nested/link").symlink_to(root / "SKILL.md")
    with pytest.raises((ValueError, OSError)):
        async with packer.open_release("author", "release", relative):
            pass


async def test_cancelled_pack_closes_result_when_background_thread_finishes(tmp_path, monkeypatch):
    packer = SkillArchivePacker(
        root=tmp_path, max_files=10, max_expanded_bytes=1000, max_archive_bytes=5000
    )
    started, finish = threading.Event(), threading.Event()
    result = io.BytesIO(b"synthetic")

    def delayed(*_args):
        started.set()
        finish.wait(timeout=5)
        return result, object()

    monkeypatch.setattr(packer, "_pack", delayed)

    async def run():
        async with packer.open_release("author", "release", "path"):
            pass

    task = asyncio.create_task(run())
    assert await asyncio.to_thread(started.wait, 2)
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    finish.set()
    for _ in range(100):
        if result.closed:
            break
        await asyncio.sleep(0.01)
    assert result.closed


async def test_changed_published_skill_cannot_be_accepted_or_sent(tmp_path):
    from app.console.creative_workshop.models import CreativeItem, CreativeRelease
    from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
    from fpl_creative.install_batch import build_install_batch
    from fpl_creative.installation_outbox import InstallationOutbox, InstallIntentConflict
    from fpl_creative.migrations.registry import MIGRATIONS
    from fpl_creative.skill_archive import CreativeSkillArchives
    from fpl_creative.storage import creative_database
    from fpl_runtime.migrations import apply

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    root = tmp_path / "accounts/author/creative-workshop/skill-releases/release"
    root.mkdir(parents=True)
    content = b"---\nname: sample\ndescription: Test\n---\n"
    (root / "SKILL.md").write_bytes(content)
    packer = SkillArchivePacker(
        root=tmp_path, max_files=10, max_expanded_bytes=1000, max_archive_bytes=5000
    )
    request = CreativeInstallPreviewIn(release_id="release")
    try:
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            session.add(
                CreativeItem(
                    id="item",
                    origin_owner_user_id="author",
                    author_user_id="author",
                    kind="skill",
                    status="published",
                )
            )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="release",
                    item_id="item",
                    version=1,
                    title="Skill",
                    manifest={"name": "sample", "file_count": 1, "expanded_bytes": len(content)},
                    skill_path="creative-workshop/skill-releases/release",
                )
            )
            await session.commit()
        batch = await build_install_batch(db, packer, request)
        (root / "SKILL.md").write_bytes(content.replace(b"sample", b"tamper"))
        with pytest.raises(InstallIntentConflict):
            await InstallationOutbox(db, skill_root=tmp_path).accept("alice", request, batch)
        with pytest.raises(InstallIntentConflict):
            async with CreativeSkillArchives(db, packer).open(batch):
                pass
    finally:
        await db.close()


async def test_archive_size_limit_cleans_temporary_file(tmp_path):
    root = tmp_path / "accounts/author/creative-workshop/skill-releases/release"
    root.mkdir(parents=True)
    (root / "SKILL.md").write_bytes(b"some content")
    packer = SkillArchivePacker(
        root=tmp_path, max_files=10, max_expanded_bytes=1000, max_archive_bytes=40
    )
    with pytest.raises(ValueError, match="大小超限"):
        async with packer.open_release(
            "author", "release", "creative-workshop/skill-releases/release"
        ):
            pass
    assert list((tmp_path / ".creative-archive-staging").iterdir()) == []
