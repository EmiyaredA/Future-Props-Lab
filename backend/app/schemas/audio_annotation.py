from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

STABLE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"
HEX_COLOR_PATTERN = r"^#[0-9A-Fa-f]{6}$"
LANGUAGE_CODE_PATTERN = r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"


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


AUDIO_ANNOTATION_EMOTION_COLORS = (
    "#28B8A7",
    "#4C8FE8",
    "#9B62D0",
    "#E7A72F",
    "#ED7A52",
    "#D85E9D",
    "#7586E5",
    "#46B978",
)


class AudioAnnotationCustomEmotion(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = Field(pattern=HEX_COLOR_PATTERN)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("自定义情绪不能为空")
        return cleaned


def normalize_custom_emotion_items(value: object) -> list[AudioAnnotationCustomEmotion]:
    if not isinstance(value, list):
        raise ValueError("自定义情绪必须是列表")
    cleaned: list[AudioAnnotationCustomEmotion] = []
    for index, item in enumerate(value):
        if isinstance(item, str):
            label = item.strip()
            if not label:
                raise ValueError("自定义情绪不能为空")
            if len(label) > 40:
                raise ValueError("自定义情绪不能超过 40 个字符")
            cleaned.append(
                AudioAnnotationCustomEmotion(
                    name=label,
                    color=AUDIO_ANNOTATION_EMOTION_COLORS[
                        index % len(AUDIO_ANNOTATION_EMOTION_COLORS)
                    ],
                )
            )
            continue
        if isinstance(item, AudioAnnotationCustomEmotion):
            cleaned.append(item)
            continue
        if isinstance(item, dict):
            cleaned.append(AudioAnnotationCustomEmotion.model_validate(item))
            continue
        raise ValueError("自定义情绪必须是名称或带颜色的对象")
    return cleaned


class AudioAnnotationLocalizedText(BaseModel):
    language: str = Field(pattern=LANGUAGE_CODE_PATTERN, max_length=35)
    text: str = Field(default="", max_length=20_000)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        return value.lower()


class AudioAnnotationSpeakerEmotion(BaseModel):
    speaker_id: str = Field(pattern=STABLE_ID_PATTERN)
    emotion: str = Field(min_length=1, max_length=40)

    @field_validator("emotion")
    @classmethod
    def normalize_emotion(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("情绪不能为空")
        return cleaned


class AudioAnnotationSegment(BaseModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    speaker_id: str | None = Field(default=None, pattern=STABLE_ID_PATTERN)
    speaker_ids: list[Annotated[str, Field(pattern=STABLE_ID_PATTERN)]] = Field(
        default_factory=list, max_length=64
    )
    emotion: str | None = Field(default=None, max_length=40)
    speaker_emotions: list[AudioAnnotationSpeakerEmotion] = Field(
        default_factory=list, max_length=64
    )
    text: str = Field(default="", max_length=20_000)
    language: str | None = Field(default=None, pattern=LANGUAGE_CODE_PATTERN, max_length=35)
    localized_texts: list[AudioAnnotationLocalizedText] = Field(default_factory=list, max_length=32)
    status: Literal["draft", "reviewed"] = "draft"

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str | None) -> str | None:
        return value.lower() if value is not None else None

    @field_validator("emotion")
    @classmethod
    def normalize_emotion(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def speaker_and_localized_languages_are_valid(self) -> AudioAnnotationSegment:
        speaker_ids = self.speaker_ids or ([self.speaker_id] if self.speaker_id else [])
        if len(speaker_ids) != len(set(speaker_ids)):
            raise ValueError("同一片段的说话人不能重复")
        if self.speaker_id is not None and speaker_ids and self.speaker_id != speaker_ids[0]:
            raise ValueError("主说话人必须是说话人列表的第一项")
        self.speaker_ids = speaker_ids
        self.speaker_id = speaker_ids[0] if speaker_ids else None

        emotion_speaker_ids = [item.speaker_id for item in self.speaker_emotions]
        if len(emotion_speaker_ids) != len(set(emotion_speaker_ids)):
            raise ValueError("同一片段的说话人情绪不能重复")
        if any(speaker_id not in speaker_ids for speaker_id in emotion_speaker_ids):
            raise ValueError("说话人情绪必须绑定到该片段已选说话人")
        if not self.speaker_emotions and self.emotion and speaker_ids:
            self.speaker_emotions = [
                AudioAnnotationSpeakerEmotion(speaker_id=speaker_id, emotion=self.emotion)
                for speaker_id in speaker_ids
            ]
        if self.speaker_emotions:
            unique_emotions = {item.emotion for item in self.speaker_emotions}
            self.emotion = (
                next(iter(unique_emotions)) if len(unique_emotions) == 1 else None
            )
        elif not speaker_ids:
            # keep segment-level emotion when no speakers are assigned
            pass
        else:
            self.emotion = None

        languages = [item.language for item in self.localized_texts]
        if len(languages) != len(set(languages)):
            raise ValueError("同一片段不能重复添加同一种语言")
        if self.language is not None and self.language.lower() in languages:
            raise ValueError("原文语言不能同时作为附加语言版本")
        return self


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
    custom_emotions: list[AudioAnnotationCustomEmotion] = Field(
        default_factory=list, max_length=64
    )
    segments: list[AudioAnnotationSegment] = Field(default_factory=list, max_length=5000)

    @field_validator("custom_emotions", mode="before")
    @classmethod
    def normalize_custom_emotions(cls, value: object) -> list[AudioAnnotationCustomEmotion]:
        return normalize_custom_emotion_items(value)

    @model_validator(mode="after")
    def identifiers_and_names_are_unique(self) -> AudioAnnotationDocumentPutIn:
        speaker_ids = [speaker.id for speaker in self.speakers]
        segment_ids = [segment.id for segment in self.segments]
        names = [speaker.name.casefold() for speaker in self.speakers]
        emotion_keys = [emotion.name.casefold() for emotion in self.custom_emotions]
        if len(speaker_ids) != len(set(speaker_ids)):
            raise ValueError("说话人 ID 不能重复")
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("片段 ID 不能重复")
        if len(names) != len(set(names)):
            raise ValueError("说话人名称不能重复")
        if len(emotion_keys) != len(set(emotion_keys)):
            raise ValueError("自定义情绪不能重复")
        return self


class AudioAnnotationDocumentOut(BaseModel):
    project_id: str
    schema_version: Literal["1.0"]
    speakers: list[AudioAnnotationSpeaker]
    custom_emotions: list[AudioAnnotationCustomEmotion] = Field(default_factory=list)
    segments: list[AudioAnnotationSegment]
    revision: int
    updated_at: str

    @field_validator("custom_emotions", mode="before")
    @classmethod
    def normalize_custom_emotions(cls, value: object) -> list[AudioAnnotationCustomEmotion]:
        return normalize_custom_emotion_items(value)


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
    custom_emotions: list[AudioAnnotationCustomEmotion] = Field(
        default_factory=list, max_length=64
    )
    segments: list[AudioAnnotationSegment] = Field(default_factory=list, max_length=5000)

    @field_validator("custom_emotions", mode="before")
    @classmethod
    def normalize_custom_emotions(cls, value: object) -> list[AudioAnnotationCustomEmotion]:
        return normalize_custom_emotion_items(value)

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
            custom_emotions=self.custom_emotions,
            segments=self.segments,
        )
        return self


class AudioAnnotationTranscriptionSegmentIn(BaseModel):
    speaker: str = Field(default="unknown", max_length=80)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str = Field(default="", max_length=20_000)


class AudioAnnotationTranscriptionTaskImportIn(BaseModel):
    source_kind: Literal["task"]
    task_id: str = Field(min_length=1, max_length=36)
    title: str | None = Field(default=None, max_length=120)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _clean_title(value)


class AudioAnnotationTranscriptionJsonImportIn(BaseModel):
    source_kind: Literal["json"]
    title: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(min_length=1, max_length=36)
    text: str = ""
    segments: list[AudioAnnotationTranscriptionSegmentIn] = Field(
        default_factory=list, max_length=5000
    )

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class AudioAnnotationSegmentTranscriptionOut(BaseModel):
    text: str
    model_id: str
    requested_language: str | None
    resolved_language: str
    requested_target_language: str | None
    resolved_target_language: str | None
    log_id: str


AudioAnnotationTranscriptionImportIn = Annotated[
    AudioAnnotationTranscriptionTaskImportIn | AudioAnnotationTranscriptionJsonImportIn,
    Field(discriminator="source_kind"),
]
