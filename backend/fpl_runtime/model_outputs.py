"""A digest-bound private Models output descriptor, without foreign storage locations."""

import base64
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelOutputDescription:
    filename: str
    mime_type: str
    byte_size: int
    content_sha256: str

    def __post_init__(self):
        if (
            not isinstance(self.filename, str)
            or not 1 <= len(self.filename) <= 255
            or Path(self.filename).name != self.filename
            or "\\" in self.filename
            or any(ord(value) < 32 for value in self.filename)
            or not isinstance(self.mime_type, str)
            or not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", self.mime_type)
            or type(self.byte_size) is not int
            or self.byte_size < 1
            or not isinstance(self.content_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", self.content_sha256)
        ):
            raise ValueError("模型结果描述无效")

    def encoded(self):
        return json.dumps(
            asdict(self), sort_keys=True, ensure_ascii=True, separators=(",", ":")
        ).encode()

    @property
    def fingerprint(self):
        return hashlib.sha256(self.encoded()).hexdigest()

    def header(self):
        return base64.b64encode(self.encoded()).decode("ascii")

    @classmethod
    def from_header(cls, value):
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            raise ValueError("模型结果描述无效")
        return cls(**json.loads(base64.b64decode(value, validate=True)))

    @classmethod
    def from_file(cls, path, filename, mime_type):
        if path.is_symlink() or not path.is_file():
            raise ValueError("模型结果文件不存在")
        size, digest = 0, hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
        return cls(filename, mime_type, size, digest.hexdigest())


def model_output_path(task_id, fingerprint):
    if (
        not isinstance(task_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", task_id)
        or not isinstance(fingerprint, str)
        or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
    ):
        raise ValueError("模型结果标识无效")
    return f"/_internal/v1/model-library-outputs/{task_id}/{fingerprint}"


def is_model_output_path(path):
    return bool(
        re.fullmatch(r"/_internal/v1/model-library-outputs/[A-Za-z0-9_-]{1,128}/[0-9a-f]{64}", path)
    )
