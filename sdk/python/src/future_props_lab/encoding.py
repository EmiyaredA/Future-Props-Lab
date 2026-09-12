"""Wire encoding preserves the difference between missing fields and explicit null."""

from collections.abc import Mapping
from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel


class Unset:
    def __repr__(self):
        return "UNSET"


UNSET = Unset()


def encode(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True, exclude_unset=True)
    if isinstance(value, Mapping):
        return {key: encode(item) for key, item in value.items() if not isinstance(item, Unset)}
    if isinstance(value, (list, tuple)):
        return [encode(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return value


def form_fields(body: Any) -> dict:
    import json

    return {
        key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, bool)) else value
        for key, value in encode(body or {}).items()
        if value is not None
    }
