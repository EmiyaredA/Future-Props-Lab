"""Path checks shared by ZIP readers that unpack user-supplied archives."""

import stat
from pathlib import PurePosixPath
from zipfile import ZipInfo


def safe_zip_member(item: ZipInfo) -> bool:
    path = PurePosixPath(item.filename)
    mode = item.external_attr >> 16
    return bool(path.parts) and not (
        path.is_absolute()
        or ".." in path.parts
        or "\\" in item.filename
        or path.parts[0].endswith(":")
        or "\x00" in item.orig_filename
        or stat.S_ISLNK(mode)
    )
