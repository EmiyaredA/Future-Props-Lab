from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.galgame_workshop.base import STABLE_ID_PATTERN, GalgameStoryModel


class GalgameProjectAssetOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str
    media_kind: Literal["image", "audio", "video", "font"]
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str
    category: Literal[
        "character", "scene", "cg", "bgm", "ambient", "sfx", "voice", "video", "font", "other"
    ] = "other"
    virtual_path: str = Field(default="", alias="virtualPath")
    packaging_policy: Literal["auto", "include", "exclude"] = Field(
        default="auto", alias="packagingPolicy"
    )
    checksum_sha256: str | None = Field(default=None, alias="checksumSha256")
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")
    transcript: str | None = None
    transcript_language: str | None = Field(default=None, alias="transcriptLanguage")
    transcript_status: Literal["pending", "queued", "running", "ready", "failed"] = Field(
        default="pending", alias="transcriptStatus"
    )
    transcript_source: Literal["asr", "manual"] | None = Field(
        default=None, alias="transcriptSource"
    )
    transcript_revision: int = Field(default=0, alias="transcriptRevision")


class GalgameProjectAssetListOut(BaseModel):
    items: list[GalgameProjectAssetOut]


GalgameAssetCategory = Literal[
    "character", "scene", "cg", "bgm", "ambient", "sfx", "voice", "video", "font", "other"
]
GalgameAssetPackagingPolicy = Literal["auto", "include", "exclude"]


class GalgameAssetImportPreviewIn(GalgameStoryModel):
    filenames: list[str] = Field(min_length=1, max_length=500)
    category: GalgameAssetCategory


class GalgameAssetImportPreviewItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    original_name: str = Field(alias="originalName")
    final_name: str = Field(alias="finalName")
    virtual_path: str = Field(alias="virtualPath")
    reasons: list[str] = Field(default_factory=list)


class GalgameAssetImportPreviewOut(BaseModel):
    items: list[GalgameAssetImportPreviewItem]


class GalgameAssetBatchUploadOut(BaseModel):
    items: list[GalgameProjectAssetOut]
    import_items: list[GalgameAssetImportPreviewItem] = Field(alias="importItems")


class GalgameProjectAssetPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    display_name: str | None = Field(
        default=None, alias="displayName", min_length=1, max_length=255
    )
    category: GalgameAssetCategory | None = None
    virtual_path: str | None = Field(
        default=None, alias="virtualPath", min_length=1, max_length=512
    )
    packaging_policy: GalgameAssetPackagingPolicy | None = Field(
        default=None, alias="packagingPolicy"
    )

    @model_validator(mode="after")
    def has_change(self) -> GalgameProjectAssetPatchIn:
        if all(
            value is None
            for value in (
                self.display_name,
                self.category,
                self.virtual_path,
                self.packaging_policy,
            )
        ):
            raise ValueError("至少需要提供一个修改字段")
        return self


class GalgamePackageManifestItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_id: str = Field(alias="assetId")
    virtual_path: str = Field(alias="virtualPath")
    byte_size: int = Field(alias="byteSize")
    reason: Literal["referenced", "forced"]


class GalgamePackageManifestIssue(BaseModel):
    code: str
    asset_id: str | None = Field(default=None, alias="assetId")
    story_asset_id: str | None = Field(default=None, alias="storyAssetId")
    message: str


class GalgamePackageManifestOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ready: bool
    total_bytes: int = Field(alias="totalBytes")
    items: list[GalgamePackageManifestItem]
    issues: list[GalgamePackageManifestIssue]


class GalgameMissingAssetRepairIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    story_asset_id: str = Field(alias="storyAssetId", pattern=STABLE_ID_PATTERN)
    replacement_file_id: str = Field(alias="replacementFileId", min_length=1, max_length=36)
