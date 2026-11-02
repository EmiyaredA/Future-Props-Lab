from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

VisualAssetScope = Literal["library", "project"]
VisualAssetKind = Literal["image", "video", "audio", "font", "document"]
StorageLayoutIssueCode = Literal["source_missing", "target_conflict", "copy_failed"]


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


class FilePreviewOut(BaseModel):
    kind: Literal["image", "video", "audio", "pdf", "text", "unsupported"]
    duration_seconds: float | None = None
    waveform_seconds: float | None = None
    page_count: int | None = None
    text: str | None = None
    truncated: bool = False


class VisualAssetImportIn(BaseModel):
    source_scope: VisualAssetScope
    source_project_id: str | None = None
    asset_ids: list[str] = Field(min_length=1)

    @field_validator("asset_ids")
    @classmethod
    def asset_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("asset_ids 不能包含重复项")
        return value

    @model_validator(mode="after")
    def source_matches_scope(self) -> VisualAssetImportIn:
        if self.source_scope == "project" and self.source_project_id is None:
            raise ValueError("项目来源必须指定 source_project_id")
        if self.source_scope == "library" and self.source_project_id is not None:
            raise ValueError("公共库来源不能指定 source_project_id")
        return self


class LibraryAssetImportIn(BaseModel):
    source_project_id: str
    asset_ids: list[str] = Field(min_length=1)
    folder_id: str | None = None
    display_names: dict[str, str] = Field(default_factory=dict)

    @field_validator("asset_ids")
    @classmethod
    def asset_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("asset_ids 不能包含重复项")
        return value

    @field_validator("display_names")
    @classmethod
    def display_names_are_clean(cls, value: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for asset_id, name in value.items():
            cleaned[asset_id] = _clean_name(name)
        return cleaned

    @model_validator(mode="after")
    def display_names_match_assets(self) -> LibraryAssetImportIn:
        unknown = set(self.display_names) - set(self.asset_ids)
        if unknown:
            raise ValueError("display_names 只能包含 asset_ids 中的素材")
        return self


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


class StorageLayoutIssueOut(BaseModel):
    asset_id: str
    code: StorageLayoutIssueCode
    message: str


class StorageLayoutStatusOut(BaseModel):
    account_upgrade_pending: int = 0
    restart_required: bool = False
    target_version: Literal[2] = 2
    pending_projects: int
    pending_assets: int
    migrated_assets: int
    pending_bytes: int
    missing_files: int
    conflicting_files: int
    complete: bool


class StorageLayoutMigrationOut(BaseModel):
    account_upgrade_pending: int = 0
    restart_required: bool = False
    processed_assets: int
    migrated_projects: int
    migrated_assets: int
    already_materialized_assets: int
    missing_files: int
    conflicts: int
    remaining_projects: int
    remaining_assets: int
    issues: list[StorageLayoutIssueOut]
    complete: bool


LibraryFolderImportSkipCode = Literal[
    "unsafe_relative_path",
    "invalid_folder_name",
    "folder_depth_exceeded",
    "name_conflict",
    "unsupported_file_type",
    "file_too_large",
    "file_type_mismatch",
    "invalid_file_content",
    "invalid_svg",
    "copy_failed",
    "not_found",
]


class LibraryFolderImportSkippedOut(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    code: LibraryFolderImportSkipCode | str
    message: str = Field(min_length=1, max_length=500)


class LibraryFolderImportOut(BaseModel):
    created_folders: int = Field(ge=0)
    created_files: int = Field(ge=0)
    skipped: list[LibraryFolderImportSkippedOut]


__all__ = [
    "VisualAssetFolderCreateIn",
    "VisualAssetFolderListOut",
    "VisualAssetFolderOut",
    "VisualAssetFolderPatchIn",
    "VisualAssetImportIn",
    "VisualAssetListOut",
    "VisualAssetOut",
    "VisualAssetPatchIn",
    "VisualAssetReferenceCreateIn",
    "VisualAssetReferencePatchIn",
    "StorageLayoutIssueOut",
    "StorageLayoutMigrationOut",
    "StorageLayoutStatusOut",
    "LibraryFolderImportOut",
    "LibraryFolderImportSkippedOut",
]


class SvgPreviewIn(BaseModel):
    svg: str = Field(max_length=2 * 1024 * 1024)


class SvgPreviewOut(BaseModel):
    svg: str
    width: float
    height: float
    monochrome: bool
