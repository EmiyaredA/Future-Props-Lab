from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit


class ExternalError(Exception):
    def __init__(
        self,
        message: str,
        status: int = 422,
        code: str = "external_connection_error",
        *,
        provider_code: int | None = None,
    ):
        super().__init__(message)
        self.status, self.code, self.provider_code = status, code, provider_code


@dataclass(frozen=True)
class ConnectionSnapshot:
    """An authorized connection revision; never carries ciphertext or ORM state."""

    id: str
    revision: int
    enabled: bool


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@dataclass(frozen=True)
class DocumentTarget:
    kind: str
    token: str
    host: str

    @property
    def url(self) -> str:
        return f"https://{self.host}/{self.kind}/{self.token}"


def document_target(url: str) -> DocumentTarget:
    try:
        parsed = urlsplit(url.strip())
        port = parsed.port
    except ValueError:
        raise ExternalError("文档链接格式不正确") from None
    match = re.fullmatch(r"/(docx|wiki)/([a-zA-Z0-9]+)/?", parsed.path)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not re.fullmatch(r"[a-zA-Z0-9-]+\.feishu\.cn", parsed.hostname)
        or parsed.username
        or parsed.password
        or port not in {None, 443}
        or match is None
    ):
        raise ExternalError(
            "请填写飞书新版文档的 HTTPS 链接，可以是 /docx/ 文档或知识库中的 /wiki/ 节点"
        )
    return DocumentTarget(match.group(1), match.group(2), parsed.hostname)


@dataclass(frozen=True)
class ConnectionCredentials:
    app_id: str
    app_secret: str = field(repr=False)


@dataclass(frozen=True)
class ImageSource:
    filename: str
    content_type: str
    data: bytes = field(repr=False)


@dataclass(frozen=True)
class RemoteDocument:
    document_id: str
    title: str
    revision: int
    blocks: list[dict]
    root_ids: list[str]

    @property
    def fingerprint(self) -> str:
        return fingerprint({"title": self.title, "blocks": self.blocks})

    @property
    def text(self) -> str:
        rows = []
        for block in self.blocks:
            if block.get("block_type") == 27:
                rows.append("[图片]")
            elif block.get("block_type") == 31:
                rows.append("[表格]")
            for value in block.values():
                if isinstance(value, dict) and "elements" in value:
                    rows.append(
                        "".join(e.get("text_run", {}).get("content", "") for e in value["elements"])
                    )
        return "\n".join(rows)

    def snapshot(self) -> dict:
        return {
            "document_id": self.document_id,
            "title": self.title,
            "revision": self.revision,
            "blocks": self.blocks,
            "root_ids": self.root_ids,
            "fingerprint": self.fingerprint,
            "text": self.text,
        }
