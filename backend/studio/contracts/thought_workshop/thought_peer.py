"""Two purpose-specific credentials shared only by Thought and Assets."""

import json
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ThoughtPeer:
    community: str = field(repr=False)
    upload_receipt: str = field(repr=False)

    @classmethod
    def read(cls, path, *, identity_credential):
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or set(data) != {"community", "upload_receipt"}:
            raise ValueError("Thought 对等配置字段无效")
        if (
            any(
                not isinstance(value, str) or not value.isascii() or len(value) < 32
                for value in data.values()
            )
            or len({identity_credential, *data.values()}) != 3
        ):
            raise ValueError("Thought 对等凭据必须彼此独立")
        return cls(**data)
