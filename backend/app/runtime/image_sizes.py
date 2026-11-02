"""Shared bounded UI preview dimensions, without file-library or account ownership."""

from typing import Annotated, Literal

from pydantic import BeforeValidator

ThumbnailSize = Annotated[
    Literal[128, 320, 640, 1280],
    BeforeValidator(
        lambda value: int(value) if isinstance(value, str) and value.isdecimal() else value
    ),
]
