"""Pure Story import validation shared by the compatibility and owned Galgame apps."""

from app.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIssue,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportSegmentOut,
    GalgameStoryDialogueBlock,
)


def _effective_text(segment) -> str:
    localized = next(
        (
            item.text.strip()
            for item in segment.localized_texts
            if item.language == "zh" and item.text.strip()
        ),
        "",
    )
    if localized:
        return localized
    if segment.language in {None, "zh"}:
        return segment.text.strip()
    return ""


def _curtain_intervals(segments, duration_ms: int) -> list[dict]:
    intervals: list[dict] = []
    if segments and segments[0].start_ms >= 500:
        intervals.append({"kind": "opening", "startMs": 0, "endMs": segments[0].start_ms})
    for left, right in zip(segments, segments[1:], strict=False):
        if right.start_ms - left.end_ms >= 500:
            intervals.append({"kind": "internal", "startMs": left.end_ms, "endMs": right.start_ms})
    if segments and duration_ms - segments[-1].end_ms >= 500:
        intervals.append({"kind": "ending", "startMs": segments[-1].end_ms, "endMs": duration_ms})
    return intervals


def build_import_preview(story, body, source, source_checksum, master_matches):
    speakers, segments = source.speakers, source.segments
    issues: list[GalgameAnnotationImportIssue] = []

    def issue(code: str, message: str, path: str = "") -> None:
        issues.append(GalgameAnnotationImportIssue(code=code, message=message, path=path))

    if source.revision != body.expected_source_revision:
        issue(
            "source_revision_conflict",
            (f"标注文档 revision 已从 {body.expected_source_revision} 变为 {source.revision}"),
            "/expectedSourceRevision",
        )
    if story.revision != body.expected_story_revision:
        issue(
            "story_revision_conflict",
            f"Story revision 已从 {body.expected_story_revision} 变为 {story.revision}",
            "/expectedStoryRevision",
        )

    requirements = body.requirements
    if len(segments) != requirements.segment_count:
        issue("segment_count_mismatch", "标注片段数量不符合导入要求", "/requirements/segmentCount")
    if len(speakers) != requirements.speaker_count:
        issue(
            "speaker_count_mismatch",
            "标注说话人数量不符合导入要求",
            "/requirements/speakerCount",
        )
    if source.duration_ms != requirements.timeline_duration_ms:
        issue(
            "timeline_duration_mismatch",
            "源音频时长不符合导入要求",
            "/requirements/timelineDurationMs",
        )
    if source_checksum != requirements.source_checksum_sha256:
        issue(
            "source_checksum_mismatch",
            "源音频校验和不符合导入要求",
            "/requirements/sourceChecksumSha256",
        )
    if segments and segments[-1].end_ms != requirements.last_dialogue_end_ms:
        issue(
            "last_dialogue_mismatch",
            "末句结束时间不符合导入要求",
            "/requirements/lastDialogueEndMs",
        )
    if set(body.speaker_map) != {speaker.id for speaker in speakers}:
        issue("speaker_map_mismatch", "说话人映射必须完整且不能包含未知说话人", "/speakerMap")

    segments_by_id = {segment.id: segment for segment in segments}
    for segment_id, speaker_ids in body.segment_speaker_overrides.items():
        segment = segments_by_id.get(segment_id)
        if segment is None:
            issue(
                "unknown_speaker_override_segment",
                "片段说话人覆盖引用了不存在的 segmentId",
                "/segmentSpeakerOverrides",
            )
        elif segment.speaker_ids:
            issue(
                "annotated_speaker_override",
                "已有标注说话人的片段不能被导入配置覆盖",
                f"/segmentSpeakerOverrides/{segment_id}",
            )
        elif any(speaker_id not in body.speaker_map for speaker_id in speaker_ids):
            issue(
                "unknown_speaker_override",
                "片段说话人覆盖引用了未知说话人",
                f"/segmentSpeakerOverrides/{segment_id}",
            )

    previous_end = 0
    for index, segment in enumerate(segments):
        if not _effective_text(segment):
            issue("missing_chinese_text", "片段缺少中文对白", f"/segments/{index}")
        if segment.start_ms < previous_end:
            issue("overlapping_segments", "标注片段存在重叠", f"/segments/{index}")
        previous_end = segment.end_ms
        if not segment.speaker_ids and segment.id not in body.segment_speaker_overrides:
            issue(
                "missing_segment_speaker",
                "片段没有标注说话人，必须提供显式覆盖",
                f"/segments/{index}",
            )

    fragments = [fragment for chapter in body.document.chapters for fragment in chapter.fragments]
    fragment = fragments[0] if len(fragments) == 1 else None
    if fragment is None:
        issue("fragment_count_mismatch", "导入 Story 必须只有一个 Fragment", "/document/chapters")
    elif fragment.timeline is None or fragment.timeline.duration_ms != source.duration_ms:
        issue(
            "story_timeline_mismatch",
            "Story 时间轴必须与完整源音频等长",
            "/document/chapters/0/fragments/0/timeline",
        )

    voice_assets = [
        asset
        for asset in body.document.assets
        if asset.type == "audio" and asset.role == "voiceLine"
    ]
    masters = [
        asset
        for asset in body.document.assets
        if asset.type == "audio" and asset.role == "timelineMaster"
    ]
    if len(masters) != 1 or masters[0].file_id != body.master_asset_id:
        issue(
            "master_audio_mismatch",
            "时间轴主音轨必须引用请求指定的完整广播剧音频",
            "/document/assets",
        )
    elif fragment and (
        fragment.timeline is None
        or fragment.timeline.master_audio is None
        or fragment.timeline.master_audio.asset_id != masters[0].id
    ):
        issue(
            "master_audio_timeline_mismatch",
            "Fragment 未引用完整主音轨",
            "/document/chapters/0/fragments/0/timeline/masterAudio",
        )
    if not master_matches:
        issue(
            "master_audio_metadata_mismatch",
            "完整源音频必须具有当前 Galgame 项目可用的准确素材元数据",
            "/document/assets",
        )

    segment_ids = {segment.id for segment in segments}
    if (
        len(voice_assets) != len(segments)
        or {asset.file_id for asset in voice_assets} != segment_ids
    ):
        issue(
            "voice_placeholder_mismatch",
            "每个标注 segmentId 必须对应一个唯一 voiceLine 素材占位",
            "/document/assets",
        )

    dialogues = (
        [block for block in fragment.blocks if isinstance(block, GalgameStoryDialogueBlock)]
        if fragment
        else []
    )
    bindings: list[GalgameAnnotationImportSegmentOut] = []
    dialogue_by_voice: dict[str, list[GalgameStoryDialogueBlock]] = {}
    for dialogue in dialogues:
        if dialogue.voice_asset_id:
            dialogue_by_voice.setdefault(dialogue.voice_asset_id, []).append(dialogue)
    segment_by_id = {segment.id: segment for segment in segments}
    multi_speaker_count = 0
    for index, voice_asset in enumerate(voice_assets):
        segment = segment_by_id.get(voice_asset.file_id)
        linked = dialogue_by_voice.get(voice_asset.id, [])
        if segment is None or len(linked) != 1:
            issue(
                "dialogue_binding_mismatch",
                "voiceLine 必须恰好绑定一条对应对白",
                f"/document/assets/{index}",
            )
            continue
        dialogue = linked[0]
        source_speakers = segment.speaker_ids or body.segment_speaker_overrides.get(segment.id, [])
        story_speakers = [
            body.speaker_map[item] for item in source_speakers if item in body.speaker_map
        ]
        if len(source_speakers) > 1:
            multi_speaker_count += 1
        if dialogue.start_ms != segment.start_ms or dialogue.end_ms != segment.end_ms:
            issue(
                "dialogue_time_mismatch",
                "对白时间与标注片段不一致",
                f"/document/blocks/{dialogue.id}",
            )
        if dialogue.text.strip() != _effective_text(segment):
            issue(
                "dialogue_text_mismatch",
                "对白中文与标注文档不一致",
                f"/document/blocks/{dialogue.id}",
            )
        if dialogue.effective_speaker_ids != story_speakers:
            issue(
                "dialogue_speaker_mismatch",
                "对白说话人与标注映射不一致",
                f"/document/blocks/{dialogue.id}",
            )
        bindings.append(
            GalgameAnnotationImportSegmentOut(
                segmentId=segment.id,
                blockId=dialogue.id,
                storyAssetId=voice_asset.id,
                startMs=segment.start_ms,
                endMs=segment.end_ms,
                text=_effective_text(segment),
                sourceSpeakerIds=source_speakers,
                storySpeakerIds=story_speakers,
            )
        )

    if len(dialogues) != requirements.segment_count or len(bindings) != len(segments):
        issue(
            "dialogue_count_mismatch",
            "Story 对白数量或绑定数量不符合要求",
            "/document/chapters",
        )
    if multi_speaker_count != requirements.multi_speaker_count:
        issue(
            "multi_speaker_count_mismatch",
            "多人对白数量不符合要求",
            "/requirements/multiSpeakerCount",
        )

    curtain_intervals = _curtain_intervals(segments, source.duration_ms)
    if len(curtain_intervals) != requirements.curtain_interval_count:
        issue(
            "curtain_interval_mismatch",
            "不少于 500ms 的幕布区间数量不符合要求",
            "/requirements/curtainIntervalCount",
        )
    curtain_events = (
        [block for block in fragment.blocks if block.type == "curtain"] if fragment else []
    )
    expected_curtain_events = max(0, len(curtain_intervals) * 2 - 1)
    if len(curtain_events) != expected_curtain_events:
        issue("curtain_event_mismatch", "Story 幕布事件没有完整覆盖选定空档", "/document/chapters")
    stage_transitions = (
        {
            block.at_ms
            for block in fragment.blocks
            if block.type == "removeCharacter" and block.all and block.at_ms not in {None, 0}
        }
        if fragment
        else set()
    )
    if len(stage_transitions) != requirements.stage_transition_count:
        issue(
            "stage_transition_mismatch",
            "舞台站位切换次数不符合要求",
            "/requirements/stageTransitionCount",
        )

    return GalgameAnnotationImportPreviewOut(
        ready=not issues,
        sourceProjectId=source.id,
        sourceRevision=source.revision,
        storyRevision=story.revision,
        sourceAssetId=source.asset_id,
        masterAssetId=body.master_asset_id,
        sourceChecksumSha256=source_checksum,
        timelineDurationMs=source.duration_ms,
        segmentCount=len(segments),
        speakerCount=len(speakers),
        multiSpeakerCount=multi_speaker_count,
        curtainIntervalCount=len(curtain_intervals),
        stageTransitionCount=len(stage_transitions),
        issues=issues,
        segments=sorted(bindings, key=lambda item: item.start_ms),
    )
