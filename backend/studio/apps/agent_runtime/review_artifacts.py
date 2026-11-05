"""Bound native review frame files by lease, content hash and declared byte size."""

import asyncio
import hashlib
import os
import re
from datetime import timedelta
from tempfile import NamedTemporaryFile
from uuid import UUID

from anyio.to_thread import run_sync
from fastapi import HTTPException

from app.capabilities.asset_store.digests import sha256_file
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.motion_compositor.motion_preview import DIGEST
from studio.contracts.visual_workshop.visual_agent_review import MAX_EXTRA_FRAMES
from studio.contracts.visual_workshop.visual_samples import MAX_FRAME_BYTES

RECOVERY_GRACE = timedelta(hours=1)
PNG = b"\x89PNG\r\n\x1a\n"


class ReviewArtifacts:
    def __init__(self, state_root):
        self.root = state_root.resolve() / "visual-review-artifacts"
        self.writer = asyncio.Lock()

    def directory(self, job_id, lease_id):
        directory = self.root / str(job_id) / str(lease_id)
        if (
            self.root.is_symlink()
            or directory.parent.is_symlink()
            or directory.is_symlink()
            or not directory.resolve().is_relative_to(self.root)
        ):
            raise HTTPException(503, "visual_review_artifacts_unavailable")
        return directory

    def stored_leases(self):
        if not self.root.is_dir() or self.root.is_symlink():
            return []
        return [
            (job.name, lease.name)
            for job in self.root.iterdir()
            if is_uuid_directory(job)
            for lease in job.iterdir()
            if is_uuid_directory(lease)
        ]

    async def remove_expired(self, job_id, lease_id):
        directory = self.directory(job_id, lease_id)
        async with self.writer:
            await run_sync(remove_managed_files, directory)

    async def store(self, request, lease, frame_id, digest):
        length = request.headers.get("content-length", "")
        if (
            request.headers.get("content-type") != "image/png"
            or request.headers.get("content-encoding", "identity") != "identity"
            or not re.fullmatch(r"[1-9][0-9]{0,7}", length)
            or not re.fullmatch(ID, frame_id)
            or not re.fullmatch(DIGEST, digest)
        ):
            raise HTTPException(422, "invalid_visual_review_artifact")
        size = int(length)
        if size > MAX_FRAME_BYTES:
            raise HTTPException(413, "visual_review_artifact_too_large")
        directory = self.directory(lease.job_id, lease.lease_id)
        target = directory / f"{frame_id}-{digest}.png"
        async with self.writer:
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target.is_symlink():
                raise HTTPException(409, "visual_review_artifact_changed")
            if target.exists():
                if target.stat().st_size != size:
                    raise HTTPException(409, "visual_review_artifact_changed")
                return {"sha256": digest}
            if sum(1 for _ in directory.glob("*.png")) >= MAX_EXTRA_FRAMES:
                raise HTTPException(409, "visual_review_artifact_limit")
            await stage_png(request, directory, target, size, digest)
        return {"sha256": digest}

    async def require(self, lease, frames):
        for frame in frames:
            await self.frame(lease.job_id, lease.lease_id, frame)

    async def frame(self, job_id, lease_id, frame):
        target = self.directory(job_id, lease_id) / f"{frame.id}-{frame.sha256}.png"
        if (
            target.is_symlink()
            or not target.is_file()
            or target.stat().st_size != frame.byte_size
            or await run_sync(sha256_file, target) != frame.sha256
        ):
            raise ValueError("追加帧尚未完整上传")
        return target


async def stage_png(request, directory, target, size, digest):
    seen, prefix = 0, bytearray()
    checksum = hashlib.sha256()
    with NamedTemporaryFile(dir=directory, prefix="incoming-") as temp:
        async for block in request.stream():
            seen += len(block)
            if seen > size:
                raise HTTPException(413, "visual_review_artifact_too_large")
            if len(prefix) < len(PNG):
                prefix.extend(block[: len(PNG) - len(prefix)])
            checksum.update(block)
            await run_sync(temp.write, block)
        if seen != size or prefix != PNG or checksum.hexdigest() != digest:
            raise HTTPException(422, "visual_review_artifact_digest_mismatch")
        await run_sync(sync_file, temp)
        # Publish a hard link to the verified inode. The temporary name is removed
        # by its context manager and cannot replace an unrelated existing artifact.
        os.link(temp.name, target)
        await run_sync(sync_directory, directory)


def sync_file(temp):
    temp.flush()
    os.fsync(temp.fileno())


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def is_uuid_directory(path):
    if path.is_symlink() or not path.is_dir():
        return False
    try:
        return str(UUID(path.name)) == path.name
    except ValueError:
        return False


def remove_managed_files(directory):
    if not directory.is_dir():
        return
    for path in directory.iterdir():
        if (
            re.fullmatch(rf"{ID}-{DIGEST}\.png|incoming-[a-z0-9_]{{8}}", path.name)
            and not path.is_symlink()
            and path.is_file()
        ):
            path.unlink()
    for path in (directory, directory.parent):
        try:
            path.rmdir()
        except OSError:
            break
