from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

STABLE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"
HEX_COLOR_PATTERN = r"^#[0-9A-Fa-f]{6}$"


def _clean_title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("任务名称不能为空")
    return cleaned


class AudioAnnotationSpeaker(BaseModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(pattern=HEX_COLOR_PATTERN)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("说话人名称不能为空")
        return cleaned


class AudioAnnotationSegment(BaseModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    speaker_id: str | None = Field(default=None, pattern=STABLE_ID_PATTERN)
    text: str = Field(default="", max_length=20_000)
    status: Literal["draft", "reviewed"] = "draft"


class AudioAnnotationProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(min_length=1, max_length=36)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class AudioAnnotationProjectPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class AudioAnnotationProjectOut(BaseModel):
    id: str
    title: str
    asset_id: str
    asset_display_name: str
    original_filename: str
    mime_type: str
    byte_size: int
    duration_ms: int
    segment_count: int
    reviewed_segment_count: int
    waveform_ready: bool
    document_revision: int
    revision: int
    created_at: str
    updated_at: str


class AudioAnnotationProjectListOut(BaseModel):
    items: list[AudioAnnotationProjectOut]


class AudioAnnotationDocumentPutIn(BaseModel):
    expected_revision: int = Field(ge=0)
    schema_version: Literal["1.0"] = "1.0"
    speakers: list[AudioAnnotationSpeaker] = Field(default_factory=list, max_length=64)
    segments: list[AudioAnnotationSegment] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def identifiers_and_names_are_unique(self) -> AudioAnnotationDocumentPutIn:
        speaker_ids = [speaker.id for speaker in self.speakers]
        segment_ids = [segment.id for segment in self.segments]
        names = [speaker.name.casefold() for speaker in self.speakers]
        if len(speaker_ids) != len(set(speaker_ids)):
            raise ValueError("说话人 ID 不能重复")
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("片段 ID 不能重复")
        if len(names) != len(set(names)):
            raise ValueError("说话人名称不能重复")
        return self


class AudioAnnotationDocumentOut(BaseModel):
    project_id: str
    schema_version: Literal["1.0"]
    speakers: list[AudioAnnotationSpeaker]
    segments: list[AudioAnnotationSegment]
    revision: int
    updated_at: str


class AudioAnnotationWaveformPutIn(BaseModel):
    expected_revision: int = Field(ge=0)
    duration_ms: int = Field(gt=0, le=3_600_000)
    peaks: list[list[float]] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def peaks_are_bounded(self) -> AudioAnnotationWaveformPutIn:
        lengths = {len(channel) for channel in self.peaks}
        if not lengths or min(lengths) == 0 or max(lengths) > 36_000:
            raise ValueError("每个声道必须包含 1 到 36000 个峰值")
        if len(lengths) != 1:
            raise ValueError("各声道峰值数量必须一致")
        if any(value < -1 or value > 1 for channel in self.peaks for value in channel):
            raise ValueError("峰值必须位于 -1 到 1 之间")
        return self


class AudioAnnotationWaveformOut(BaseModel):
    project_id: str
    duration_ms: int
    peaks: list[list[float]]
    revision: int
    updated_at: str


class AudioAnnotationImportIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(min_length=1, max_length=36)
    schema_version: Literal["1.0"] = "1.0"
    speakers: list[AudioAnnotationSpeaker] = Field(default_factory=list, max_length=64)
    segments: list[AudioAnnotationSegment] = Field(default_factory=list, max_length=5000)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def document_is_well_formed(self) -> AudioAnnotationImportIn:
        AudioAnnotationDocumentPutIn(
            expected_revision=0,
            schema_version=self.schema_version,
            speakers=self.speakers,
            segments=self.segments,
        )
        return self
