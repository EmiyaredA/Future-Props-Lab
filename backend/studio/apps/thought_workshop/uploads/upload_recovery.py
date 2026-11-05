"""Recover local upload staging only while the service holds its process lock."""

import os
import re
from pathlib import Path

from studio.apps.thought_workshop.storage.upload_records import ThoughtUploadIntent


async def recover_upload_staging(root: Path, sessions) -> None:
    """Remove confirmed copies and pre-intent orphans; preserve unknown states.

    The caller must hold the exclusive service lock before any request or worker
    can begin a new upload. Only then does an absent durable intent prove that
    no source process can still commit it or send it to Assets.
    """
    staging = Path(root).resolve() / "upload-staging"
    if staging.is_symlink():
        raise ValueError("上传暂存目录不能是符号链接")
    if not staging.exists():
        return
    if not staging.is_dir():
        raise ValueError("上传暂存路径不是目录")
    staging_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with os.scandir(staging_fd) as accounts:
            for account in accounts:
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", account.name) or not account.is_dir(
                    follow_symlinks=False
                ):
                    continue
                try:
                    account_fd = os.open(
                        account.name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=staging_fd,
                    )
                except FileNotFoundError:
                    continue
                try:
                    with os.scandir(account_fd) as files:
                        for entry in files:
                            match = re.fullmatch(r"([A-Za-z0-9_-]{1,128})\.upload", entry.name)
                            if match is None or not entry.is_file(follow_symlinks=False):
                                continue
                            async with sessions(info={"owner_user_id": account.name}) as session:
                                row = await session.get(
                                    ThoughtUploadIntent, (account.name, match[1])
                                )
                                removable = row is None or (
                                    row.state == "confirmed"
                                    and isinstance(row.result, dict)
                                    and isinstance(row.result.get("asset_id"), str)
                                    and bool(row.result["asset_id"])
                                )
                            if removable:
                                try:
                                    os.unlink(entry.name, dir_fd=account_fd)
                                except FileNotFoundError:
                                    pass
                finally:
                    os.close(account_fd)
    finally:
        os.close(staging_fd)
