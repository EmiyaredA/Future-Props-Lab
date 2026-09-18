from __future__ import annotations

import json
import sqlite3

import pytest
from pydantic import ValidationError

from app.capabilities.media_rendering.speed import audio_speed_filters, source_time_us
from app.apps.video_editor.schemas import VideoEditorClip, VideoEditorTimelineBatchIn
from app.apps.video_editor.errors import VideoEditorValidationError
from app.apps.video_editor.timeline import apply_operations
from db.migrations.versions.r0043_video_editor_playback_rate import SQL


def media_clip(clip_id="video", track_id="v", kind="video", **extra):
    return {
        "id": clip_id,
        "trackId": track_id,
        "kind": kind,
        "name": clip_id,
        "assetId": "asset",
        "timelineStartUs": 1_000_000,
        "durationUs": 4_000_000,
        "sourceInUs": 2_000_000,
        "linkGroupId": "av",
        **extra,
    }


def document():
    return {
        "tracks": [
            {"id": "v", "kind": "visual", "clips": [media_clip()]},
            {"id": "a", "kind": "audio", "clips": [media_clip("audio", "a", "audio")]},
        ]
    }


def apply(doc, *operations):
    return apply_operations(
        doc,
        VideoEditorTimelineBatchIn(
            expectedRevision=0,
            requestId="speed-test",
            operations=list(operations),
        ),
    )


def test_speed_json_migration_preserves_existing_document():
    # This connection is an isolated in-memory migration fixture only.
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE TABLE video_editor_timelines (document JSON)")
        original = document()
        original["tracks"].append({"id": "empty", "locked": False, "clips": []})
        original["tracks"][1]["clips"][0]["playbackRate"] = 2
        connection.execute("INSERT INTO video_editor_timelines VALUES (?)", (json.dumps(original),))
        connection.executescript(SQL)
        result = json.loads(
            connection.execute("SELECT document FROM video_editor_timelines").fetchone()[0]
        )
        original["tracks"][0]["clips"][0]["playbackRate"] = 1
        assert result == original
        connection.executescript(SQL)
        assert (
            json.loads(
                connection.execute("SELECT document FROM video_editor_timelines").fetchone()[0]
            )
            == original
        )


@pytest.mark.parametrize("rate", [0.25, 0.5, 1.25, 2, 4])
def test_speed_preserves_source_range_and_linked_audio(rate):
    original = document()
    original["tracks"][0]["clips"][0]["keyframes"] = [{"timeUs": 2_000_000}]
    original["tracks"][0]["clips"][0]["transitionIn"] = {"durationUs": 1_000_000}
    result = apply(original, {"type": "setClipSpeed", "clipId": "video", "playbackRate": rate})
    for track in result["tracks"]:
        clip = track["clips"][0]
        assert clip["playbackRate"] == rate
        assert clip["durationUs"] == 4_000_000 / rate
        assert clip["timelineStartUs"] == 1_000_000
        assert clip["sourceInUs"] == 2_000_000
    assert result["tracks"][0]["clips"][0]["keyframes"][0]["timeUs"] == 2_000_000 / rate
    assert result["tracks"][0]["clips"][0]["transitionIn"]["durationUs"] == 1_000_000 / rate
    assert original["tracks"][0]["clips"][0]["durationUs"] == 4_000_000


def test_speed_split_maps_right_clip_to_original_source():
    result = apply(
        document(),
        {"type": "setClipSpeed", "clipId": "video", "playbackRate": 2},
        {"type": "splitClip", "clipId": "video", "atUs": 2_000_000, "newClipId": "right"},
    )
    for track in result["tracks"]:
        left, right = track["clips"]
        assert left["durationUs"] == right["durationUs"] == 1_000_000
        assert right["sourceInUs"] == 4_000_000
        assert right["playbackRate"] == 2


def test_speed_rejects_locked_linked_track():
    original = document()
    original["tracks"][1]["locked"] = True
    with pytest.raises(VideoEditorValidationError, match="锁定"):
        apply(original, {"type": "setClipSpeed", "clipId": "video", "playbackRate": 2})


@pytest.mark.parametrize("rate", [0, -1, 0.1, 5, float("nan"), float("inf")])
def test_invalid_speed_is_rejected(rate):
    with pytest.raises(ValidationError):
        VideoEditorClip.model_validate(media_clip(playbackRate=rate))


def test_source_mapping_and_pitch_preserving_audio_filters():
    assert (
        source_time_us(VideoEditorClip.model_validate(media_clip(playbackRate=2)), 750_000)
        == 3_500_000
    )
    assert VideoEditorClip.model_validate(media_clip()).playback_rate is None
    assert audio_speed_filters(0.25) == ["atempo=0.5", "atempo=0.5"]
    assert audio_speed_filters(4) == ["atempo=2", "atempo=2"]
    assert audio_speed_filters(1) == []
