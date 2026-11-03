"""Bounded descriptions for same-account Thought uploads to Assets."""

import base64
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class ThoughtUploadDescription:
    kind: str
    filename: str
    mime_type: str
    byte_size: int
    content_sha256: str

    def __post_init__(self):
        if (
            self.kind not in {"image", "attachment"}
            or not isinstance(self.filename, str)
            or not 1 <= len(self.filename) <= 255
            or Path(self.filename).name != self.filename
            or "\\" in self.filename
            or any(ord(char) < 32 for char in self.filename)
            or not isinstance(self.mime_type, str)
            or not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", self.mime_type)
            or type(self.byte_size) is not int
            or self.byte_size < 1
            or not isinstance(self.content_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", self.content_sha256)
        ):
            raise ValueError("思绪附件描述无效")

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
            raise ValueError("思绪附件描述无效")
        return cls(**json.loads(base64.b64decode(value, validate=True)))


def upload_path(kind, request_id, fingerprint):
    if (
        kind not in {"image", "attachment"}
        or not isinstance(request_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id)
        or not isinstance(fingerprint, str)
        or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
    ):
        raise ValueError("思绪附件请求标识无效")
    return f"/_internal/v1/thought-library/uploads/{kind}/{request_id}/{fingerprint}"


def is_upload_target(method, path):
    return (
        method == "POST"
        and isinstance(path, str)
        and bool(
            re.fullmatch(
                r"/_internal/v1/thought-library/uploads/(image|attachment)/[A-Za-z0-9_-]{1,128}/[0-9a-f]{64}",
                path,
            )
        )
    )


class ThoughtUploadReceiptAuthenticator:
    """Authenticate one account's result and bind it to a fresh request nonce."""

    def __init__(self, secret):
        if not isinstance(secret, str) or not secret.isascii() or len(secret) < 32:
            raise ValueError("Thought upload receipt credential is invalid")
        self._secret = secret.encode("ascii")

    def sign(self, *, owner, request_id, fingerprint, nonce, body):
        import hmac

        if (
            not isinstance(owner, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", owner)
            or not isinstance(nonce, str)
            or not re.fullmatch(r"[a-f0-9]{32}", nonce)
            or not isinstance(body, bytes)
        ):
            raise ValueError("Thought upload receipt binding is invalid")
        upload_path("image", request_id, fingerprint)
        payload = json.dumps(
            {
                "version": 1,
                "owner": owner,
                "request_id": request_id,
                "fingerprint": fingerprint,
                "nonce": nonce,
                "body_sha256": hashlib.sha256(body).hexdigest(),
            },
            sort_keys=True,
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("ascii")
        return hmac.new(self._secret, payload, hashlib.sha256).hexdigest()

    def verify(self, signature, **binding):
        import hmac

        if not isinstance(signature, str) or not re.fullmatch(r"[a-f0-9]{64}", signature):
            raise ValueError("Thought upload receipt signature is invalid")
        if not hmac.compare_digest(signature, self.sign(**binding)):
            raise ValueError("Thought upload receipt signature does not match")
