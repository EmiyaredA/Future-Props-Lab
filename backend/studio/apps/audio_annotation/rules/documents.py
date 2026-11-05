"""Audio document and transcription rules, independent of I/O and SQL."""

from pydantic import ValidationError

from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentPutIn,
    AudioAnnotationImportIn,
    AudioAnnotationSegment,
    AudioAnnotationSpeaker,
    AudioAnnotationTranscriptionSegmentIn,
)
from studio.apps.audio_annotation.sources import AudioAnnotationError

MIN_SEGMENT_MS = 100
TRANSCRIPTION_SPEAKER_COLORS = (
    "#28B8A7",
    "#4C8FE8",
    "#9B62D0",
    "#E7A72F",
    "#ED7A52",
    "#D85E9D",
    "#7586E5",
    "#46B978",
)


def validate_document(
    duration_ms: int,
    body: AudioAnnotationDocumentPutIn | AudioAnnotationImportIn,
) -> None:
    speaker_ids = {speaker.id for speaker in body.speakers}
    previous_start = -1
    for segment in body.segments:
        if segment.end_ms - segment.start_ms < MIN_SEGMENT_MS:
            raise AudioAnnotationError("片段长度不能小于 100 毫秒", code="segment_too_short")
        if segment.end_ms > duration_ms:
            raise AudioAnnotationError("片段超出音频时长", code="segment_out_of_range")
        if segment.start_ms < previous_start:
            raise AudioAnnotationError("片段必须按开始时间排序", code="segments_unsorted")
        if any(speaker_id not in speaker_ids for speaker_id in segment.speaker_ids):
            raise AudioAnnotationError("片段引用了不存在的说话人", code="speaker_not_found")
        previous_start = segment.start_ms


def transcription_document(
    *,
    text: str,
    segments: list[AudioAnnotationTranscriptionSegmentIn],
    duration_ms: int,
    ids,
) -> tuple[list[AudioAnnotationSpeaker], list[AudioAnnotationSegment]]:
    if not segments:
        complete_text = text.strip()
        if not complete_text:
            raise AudioAnnotationError(
                "识别结果没有可导入的文本或时间戳片段",
                code="transcription_empty",
            )
        try:
            converted = [
                AudioAnnotationSegment(
                    id=ids(),
                    start_ms=0,
                    end_ms=duration_ms,
                    speaker_id=None,
                    text=complete_text,
                    status="draft",
                )
            ]
        except ValidationError as exc:
            raise AudioAnnotationError(
                "识别全文超过单个标注片段允许的长度",
                code="transcription_text_too_long",
            ) from exc
        document = AudioAnnotationImportIn(
            title="识别导入校验",
            asset_id="validation",
            schema_version="1.0",
            speakers=[],
            segments=converted,
        )
        validate_document(duration_ms, document)
        return [], converted

    ordered = sorted(
        (
            item
            for item in segments
            if item.end_ms < item.start_ms or item.end_ms - item.start_ms >= MIN_SEGMENT_MS
        ),
        key=lambda item: (item.start_ms, item.end_ms),
    )
    speakers: list[AudioAnnotationSpeaker] = []
    speaker_ids: dict[str, str] = {}
    converted: list[AudioAnnotationSegment] = []
    for item in ordered:
        label = item.speaker.strip()
        normalized_label = label.casefold()
        speaker_id: str | None = None
        if label and normalized_label != "unknown":
            speaker_id = speaker_ids.get(normalized_label)
            if speaker_id is None:
                if len(speakers) >= 64:
                    raise AudioAnnotationError(
                        "识别结果中的说话人超过 64 个",
                        code="too_many_speakers",
                    )
                speaker_id = ids()
                speaker_ids[normalized_label] = speaker_id
                speakers.append(
                    AudioAnnotationSpeaker(
                        id=speaker_id,
                        name=label,
                        color=TRANSCRIPTION_SPEAKER_COLORS[
                            len(speakers) % len(TRANSCRIPTION_SPEAKER_COLORS)
                        ],
                    )
                )
        try:
            converted.append(
                AudioAnnotationSegment(
                    id=ids(),
                    start_ms=item.start_ms,
                    end_ms=item.end_ms,
                    speaker_id=speaker_id,
                    text=item.text,
                    status="draft",
                )
            )
        except ValidationError as exc:
            raise AudioAnnotationError(
                "识别结果包含无效的时间戳或片段内容",
                code="transcription_segments_invalid",
            ) from exc
    document = AudioAnnotationImportIn(
        title="识别导入校验",
        asset_id="validation",
        schema_version="1.0",
        speakers=speakers,
        segments=converted,
    )
    validate_document(duration_ms, document)
    return speakers, converted
