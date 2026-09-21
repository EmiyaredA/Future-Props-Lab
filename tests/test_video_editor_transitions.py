import pytest
from PIL import Image

from app.apps.video_editor.schemas import VideoEditorTimelineBatchIn, VideoEditorTimelineDocument
from app.apps.video_editor.timeline import apply_operations
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.timeline_document import (
    normalize_legacy_edge_transitions,
    parse_timeline_document,
)


def _document() -> dict:
    return {
        "settings": {"width": 1920, "height": 1080, "fps": 30, "backgroundColor": "#000000"},
        "tracks": [
            {
                "id": "v1",
                "kind": "visual",
                "name": "画面 1",
                "order": 0,
                "clips": [
                    {
                        "id": "left",
                        "trackId": "v1",
                        "kind": "image",
                        "name": "左",
                        "assetId": "red",
                        "timelineStartUs": 0,
                        "durationUs": 1_000_000,
                    },
                    {
                        "id": "right",
                        "trackId": "v1",
                        "kind": "image",
                        "name": "右",
                        "assetId": "blue",
                        "timelineStartUs": 1_000_000,
                        "durationUs": 1_000_000,
                    },
                ],
            }
        ],
    }


def _apply(document: dict, *operations: dict) -> dict:
    return apply_operations(
        document,
        VideoEditorTimelineBatchIn(
            expectedRevision=0,
            requestId="transition-test",
            operations=list(operations),
        ),
    )


def test_independent_transition_crud_is_reversible() -> None:
    document = _document()
    transition = {
        "id": "cut-1",
        "kind": "crossfade",
        "durationUs": 300_000,
        "placement": "between",
        "fromClipId": "left",
        "toClipId": "right",
        "direction": "in",
        "easing": "ease-in-out",
    }
    added = _apply(document, {"type": "addTransition", "transition": transition})
    assert added["transitions"] == [transition]
    updated = _apply(
        added,
        {
            "type": "updateTransition",
            "transitionId": "cut-1",
            "patch": {"durationUs": 500_000, "easing": "linear"},
        },
    )
    assert updated["transitions"][0]["durationUs"] == 500_000
    removed = _apply(updated, {"type": "removeTransition", "transitionId": "cut-1"})
    assert removed["transitions"] == []


def test_split_moves_between_reference_and_keeps_clip_edge_fields() -> None:
    document = _document()
    document["tracks"][0]["clips"][0]["transitionOut"] = {
        "kind": "fade-black",
        "durationUs": 200_000,
        "direction": "out",
        "easing": "linear",
    }
    document["transitions"] = [
        {
            "id": "between-1",
            "kind": "wipe-left",
            "durationUs": 200_000,
            "placement": "between",
            "fromClipId": "left",
            "toClipId": "right",
            "direction": "left",
            "easing": "linear",
        },
    ]
    split = _apply(
        document,
        {
            "type": "splitClip",
            "clipId": "left",
            "atUs": 400_000,
            "newClipId": "left-right",
        },
    )
    left = next(
        clip
        for track in split["tracks"]
        for clip in track["clips"]
        if clip["id"] == "left"
    )
    right_piece = next(
        clip
        for track in split["tracks"]
        for clip in track["clips"]
        if clip["id"] == "left-right"
    )
    assert "transitionOut" not in left
    assert right_piece.get("transitionOut", {}).get("kind") == "fade-black"
    transitions = {item["id"]: item for item in split["transitions"]}
    assert transitions["between-1"]["fromClipId"] == "left-right"


def test_remove_clip_removes_dependent_seam_transitions() -> None:
    document = _document()
    document["transitions"] = [
        {
            "id": "between-1",
            "kind": "zoom",
            "durationUs": 200_000,
            "placement": "between",
            "fromClipId": "left",
            "toClipId": "right",
            "direction": "in",
            "easing": "linear",
        }
    ]
    result = _apply(document, {"type": "removeClip", "clipId": "right"})
    assert result["transitions"] == []


def test_normalize_migrates_legacy_in_out_onto_clips() -> None:
    document = _document()
    document["transitions"] = [
        {
            "id": "in-1",
            "kind": "flash",
            "durationUs": 250_000,
            "placement": "in",
            "toClipId": "right",
            "direction": "in",
            "easing": "linear",
        },
        {
            "id": "between-1",
            "kind": "crossfade",
            "durationUs": 300_000,
            "placement": "between",
            "fromClipId": "left",
            "toClipId": "right",
            "direction": "in",
            "easing": "linear",
        },
    ]
    normalized = normalize_legacy_edge_transitions(document)
    right = next(
        clip
        for track in normalized["tracks"]
        for clip in track["clips"]
        if clip["id"] == "right"
    )
    assert right["transitionIn"]["kind"] == "flash"
    assert right["transitionIn"]["durationUs"] == 250_000
    assert [item["id"] for item in normalized["transitions"]] == ["between-1"]
    parsed = parse_timeline_document(normalized)
    assert len(parsed.transitions) == 1
    assert parsed.transitions[0].placement == "between"


def test_crossfade_renderer_blends_adjacent_images() -> None:
    document = VideoEditorTimelineDocument.model_validate(
        {
            **_document(),
            "transitions": [
                {
                    "id": "crossfade",
                    "kind": "crossfade",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                }
            ],
        }
    )
    renderer = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda clip, _time: Image.new(
                "RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue"
            ),
            font_for_clip=lambda _clip: None,
        ),
    )
    # Centered window [0.5s, 1.5s); mid-blend at the 1s seam.
    frame = renderer.render(1_000_000)
    pixel = frame.getpixel((0, 0))
    assert 0 < pixel[0] < 255
    assert 0 < pixel[2] < 255


def test_seam_flash_outs_then_ins_without_double_start() -> None:
    document = parse_timeline_document(
        {
            **_document(),
            "transitions": [
                {
                    "id": "flash",
                    "kind": "flash",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                    "direction": "in",
                    "easing": "linear",
                }
            ],
        }
    )
    seen: list[tuple[str, int]] = []

    def image_for_clip(clip, local_us: int):  # type: ignore[no-untyped-def]
        seen.append((clip.id, local_us))
        return Image.new(
            "RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue"
        )

    renderer = TimelineFrameRenderer(
        document,
        FrameSource(image_for_clip=image_for_clip, font_for_clip=lambda _clip: None),
    )
    # First half: only left + rising white (G channel from flash overlay).
    before = renderer.render(750_000)
    assert before.getpixel((0, 0))[1] > 80
    assert all(clip_id == "left" for clip_id, _ in seen)
    seen.clear()
    # Second half: only right from its start + falling white.
    after = renderer.render(1_250_000)
    assert after.getpixel((0, 0))[1] > 80
    assert all(clip_id == "right" for clip_id, _ in seen)
    assert seen[0] == ("right", 250_000)


def test_crossfade_incoming_media_stays_continuous_after_window() -> None:
    """Non-flash seam windows advance incoming media from the window start.

    After the window ends, local time must keep that offset so export does not
    jump backward by half the transition duration.
    """
    document = parse_timeline_document(
        {
            **_document(),
            "tracks": [
                {
                    **_document()["tracks"][0],
                    "clips": [
                        _document()["tracks"][0]["clips"][0],
                        {
                            **_document()["tracks"][0]["clips"][1],
                            "durationUs": 3_000_000,
                        },
                    ],
                }
            ],
            "transitions": [
                {
                    "id": "crossfade",
                    "kind": "crossfade",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                    "direction": "in",
                    "easing": "linear",
                }
            ],
        }
    )
    seen: list[tuple[str, int]] = []

    def image_for_clip(clip, local_us: int):  # type: ignore[no-untyped-def]
        seen.append((clip.id, local_us))
        return Image.new(
            "RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue"
        )

    renderer = TimelineFrameRenderer(
        document,
        FrameSource(image_for_clip=image_for_clip, font_for_clip=lambda _clip: None),
    )
    # Window [0.5s, 1.5s). Near the end of the blend, incoming is ~1s into media.
    seen.clear()
    renderer.render(1_400_000)
    right_during = [local for clip_id, local in seen if clip_id == "right"]
    assert right_during == [900_000]

    # Just after the window: must continue from window-start mapping, not rewind
    # to timeline-local (which would be 500_000 here).
    seen.clear()
    renderer.render(1_500_000)
    right_after = [local for clip_id, local in seen if clip_id == "right"]
    assert right_after == [1_000_000]

    seen.clear()
    renderer.render(2_000_000)
    right_later = [local for clip_id, local in seen if clip_id == "right"]
    assert right_later == [1_500_000]


def test_clip_edge_flash_applies_after_seam() -> None:
    document = parse_timeline_document(
        {
            **_document(),
            "tracks": [
                {
                    **_document()["tracks"][0],
                    "clips": [
                        _document()["tracks"][0]["clips"][0],
                        {
                            **_document()["tracks"][0]["clips"][1],
                            "transitionIn": {
                                "kind": "flash",
                                "durationUs": 400_000,
                                "direction": "in",
                                "easing": "linear",
                            },
                        },
                    ],
                }
            ],
            "transitions": [
                {
                    "id": "between-1",
                    "kind": "crossfade",
                    "durationUs": 200_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                    "direction": "in",
                    "easing": "linear",
                }
            ],
        }
    )
    renderer = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda clip, _time: Image.new(
                "RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue"
            ),
            font_for_clip=lambda _clip: None,
        ),
    )
    # At the seam start: clip-local flash should wash the frame toward white.
    frame = renderer.render(1_000_000)
    pixel = frame.getpixel((0, 0))
    assert pixel[0] > 140
    assert pixel[1] > 140
    assert pixel[2] > 140


def test_timeline_transition_rejects_non_between_placement() -> None:
    with pytest.raises(ValueError):
        VideoEditorTimelineDocument.model_validate(
            {
                **_document(),
                "transitions": [
                    {
                        "id": "bad",
                        "kind": "crossfade",
                        "durationUs": 200_000,
                        "placement": "in",
                        "toClipId": "right",
                    }
                ],
            }
        )


def test_add_transition_rejects_edge_placement() -> None:
    document = _document()
    with pytest.raises(Exception):
        _apply(
            document,
            {
                "type": "addTransition",
                "transition": {
                    "id": "bad",
                    "kind": "flash",
                    "durationUs": 200_000,
                    "placement": "in",
                    "toClipId": "right",
                    "direction": "in",
                    "easing": "linear",
                },
            },
        )
