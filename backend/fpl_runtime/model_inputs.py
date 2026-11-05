"""Private library-file input descriptor. No filesystem path or storage key crosses services."""

from dataclasses import dataclass
from email.message import Message


@dataclass(frozen=True)
class ModelInputDescription:
    filename: str
    media_kind: str
    mime_type: str
    byte_size: int
    revision: int

    @classmethod
    def from_headers(cls, headers):
        if headers.get("Content-Encoding", "identity").lower().strip() not in {"", "identity"}:
            raise ValueError("模型输入不接受传输压缩")
        disposition = Message()
        disposition["Content-Disposition"] = headers["Content-Disposition"]
        value = cls(
            disposition.get_filename() or "",
            headers["X-Fpl-File-Kind"],
            headers["Content-Type"].split(";", 1)[0],
            int(headers["Content-Length"]),
            int(headers["X-Fpl-File-Revision"]),
        )
        if (
            not value.filename
            or not value.mime_type
            or value.byte_size < 1
            or value.revision < 0
            or value.media_kind not in {"image", "audio", "video"}
        ):
            raise ValueError("模型输入文件描述无效")
        return value
