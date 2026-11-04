"""Exact local-library operation and private native admission settings."""

import re
from types import MappingProxyType

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

OPEN_PATH = "/v1/file-storage/open-folder"
OPEN_LIBRARY = "tools.library.reveal"
PROBE_VIDEO = "tools.video.dependencies"
VIDEO_DEPS_PATH = "/v1/tool-navigation/video-download/deps"
HOST_OPERATIONS = MappingProxyType(
    {OPEN_LIBRARY: ("POST", OPEN_PATH), PROBE_VIDEO: ("GET", VIDEO_DEPS_PATH)}
)
ERRORS = {
    "library_folder_missing": (409, "文件库文件夹不存在"),
    "folder_open_unavailable": (503, "无法启动系统文件管理器"),
    "authorization_revoked": (403, "文件夹打开授权已撤销"),
}


class ToolsNativeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    identity_credential: str
    ingress: str
    workers: dict[str, str]

    @field_validator("identity_credential", "ingress")
    @classmethod
    def secret(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", value):
            raise ValueError("Tools 原生凭据格式无效")
        return value

    @model_validator(mode="after")
    def separate_secrets(self):
        if not self.workers or any(
            not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", worker) for worker in self.workers
        ):
            raise ValueError("Tools 必须登记原生执行器")
        secrets = [self.identity_credential, self.ingress, *map(self.secret, self.workers.values())]
        if len(set(secrets)) != len(secrets):
            raise ValueError("Tools 原生凭据必须分开生成")
        return self
