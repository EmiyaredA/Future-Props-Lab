"""Private Tools library upload is bound to one job and exact file and folder digest."""

import re
from dataclasses import dataclass
from uuid import UUID

from studio.contracts.tools.tools_video import VIDEO_JOB_PATH
from studio.runtime.files.signed_payloads import ModelOutputDescription

PREFIX = "/_internal/v1/tools-library-outputs"


@dataclass(frozen=True)
class ToolLibraryDescription(ModelOutputDescription):
    folder_id: str | None = None

    def __post_init__(self):
        super().__post_init__()
        if self.folder_id is not None and not (
            isinstance(self.folder_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", self.folder_id)
        ):
            raise ValueError("视频入库目录无效")


def library_path(job_id, fingerprint):
    if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        raise ValueError("视频入库摘要无效")
    return f"{PREFIX}/{UUID(str(job_id))}/{fingerprint}"


def is_library_path(path):
    match = re.fullmatch(re.escape(PREFIX) + r"/([0-9a-f-]{36})/([0-9a-f]{64})", path)
    if match is None:
        return False
    try:
        return library_path(*match.groups()) == path
    except ValueError:
        return False


def library_grant(grant):
    return (
        grant.caller == "tools"
        and grant.purpose == "tools.library-output.write"
        and grant.source_method == "POST"
        and grant.source_path == VIDEO_JOB_PATH
        and grant.target_service == "assets"
        and grant.target_method == "POST"
        and is_library_path(grant.target_path)
    )
