from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

VisualAssetScope = Literal["library", "project"]
VisualAssetKind = Literal["image", "video", "audio", "document"]


def _clean_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("名称不能为空")
    return cleaned


class VisualAssetFolderOut(BaseModel):
    id: str
    project_id: str | None
    parent_id: str | None
    name: str
    revision: int
    created_at: str
    updated_at: str


class VisualAssetFolderListOut(BaseModel):
    items: list[VisualAssetFolderOut]


class VisualAssetFolderCreateIn(BaseModel):
    scope: VisualAssetScope
    project_id: str | None = None
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_name(value)


class VisualAssetFolderPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None
    move_to_root: bool = False

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetFolderPatchIn:
        if self.name is None and self.parent_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.parent_id is not None and self.move_to_root:
            raise ValueError("parent_id 与 move_to_root 不能同时提供")
        return self


class VisualAssetOut(BaseModel):
    id: str
    project_id: str | None
    folder_id: str | None
    original_filename: str
    display_name: str
    media_kind: VisualAssetKind
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str
    source: Literal["library", "project"]
    is_reference: bool = False
    reference_id: str | None = None


class VisualAssetListOut(BaseModel):
    items: list[VisualAssetOut]


class VisualAssetPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None
    move_to_root: bool = False

    @field_validator("display_name")
    @classmethod
    def display_name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetPatchIn:
        if self.display_name is None and self.folder_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.folder_id is not None and self.move_to_root:
            raise ValueError("folder_id 与 move_to_root 不能同时提供")
        return self


class VisualAssetReferenceCreateIn(BaseModel):
    asset_id: str
    folder_id: str | None = None


class VisualAssetReferencePatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None
    move_to_root: bool = False

    @field_validator("display_name")
    @classmethod
    def display_name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetReferencePatchIn:
        if self.display_name is None and self.folder_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.folder_id is not None and self.move_to_root:
            raise ValueError("folder_id 与 move_to_root 不能同时提供")
        return self


__all__ = [
    "VisualAssetFolderCreateIn",
    "VisualAssetFolderListOut",
    "VisualAssetFolderOut",
    "VisualAssetFolderPatchIn",
    "VisualAssetListOut",
    "VisualAssetOut",
    "VisualAssetPatchIn",
    "VisualAssetReferenceCreateIn",
    "VisualAssetReferencePatchIn",
]
