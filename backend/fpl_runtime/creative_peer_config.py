"""Shared shape for the three independent Creative installation credentials."""

import json
import re
from pathlib import Path
from typing import NamedTuple


class CreativeInstallCredentials(NamedTuple):
    creative: str
    integrations: str
    result: str

    @classmethod
    def read(cls, path: Path):
        try:
            value = json.loads(path.read_text())
            if not isinstance(value, dict) or set(value) != set(cls._fields):
                raise ValueError()
            result = cls(**value)
            if (
                any(
                    not isinstance(secret, str)
                    or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", secret)
                    for secret in result
                )
                or len(set(result)) != 3
            ):
                raise ValueError()
        except (ValueError, TypeError, OSError):
            raise ValueError("Creative 安装凭据缺失、重复或无效") from None
        return result
