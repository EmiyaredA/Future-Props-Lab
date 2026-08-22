from __future__ import annotations

from pydantic import BaseModel, ConfigDict

STABLE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
CHARACTER_THEME_PALETTE = (
    "#E75B55",
    "#4AA3DF",
    "#46B978",
    "#A56DE2",
    "#E59B3D",
    "#D85E9D",
    "#32A6A0",
    "#7586E5",
)


def _clean_title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("名称不能为空")
    return cleaned


class GalgameStoryModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
