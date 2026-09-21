import pytest
from PIL import Image

from app.apps.video_editor.schemas import VideoEditorTimelineBatchIn, VideoEditorTimelineDocument
from app.apps.video_editor.timeline import apply_operations
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer


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


def test_split_moves_outgoing_edge_and_between_reference_to_right_clip() -> None:
    document = _document()
    document["transitions"] = [
        {
            "id": "out-1",
            "kind": "fade-black",
            "durationUs": 200_000,
            "placement": "out",
            "fromClipId": "left",
            "direction": "out",
            "easing": "linear",
        },
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
    transitions = {item["id"]: item for item in split["transitions"]}
    assert transitions["out-1"]["fromClipId"] == "left-right"
    assert transitions["between-1"]["fromClipId"] == "left-right"


def test_remove_clip_removes_dependent_transitions() -> None:
    document = _document()
    document["transitions"] = [
        {
            "id": "in-1",
            "kind": "zoom",
            "durationUs": 200_000,
            "placement": "in",
            "toClipId": "right",
        }
    ]
    result = _apply(document, {"type": "removeClip", "clipId": "right"})
    assert result["transitions"] == []


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
    frame = renderer.render(500_000)
    pixel = frame.getpixel((0, 0))
    assert 0 < pixel[0] < 255
    assert 0 < pixel[2] < 255


def test_timeline_transition_requires_exactly_one_edge_shape() -> None:
    with pytest.raises(ValueError, match="只引用 toClipId"):
        VideoEditorTimelineDocument.model_validate(
            {
                **_document(),
                "transitions": [
                    {
                        "id": "bad",
                        "kind": "crossfade",
                        "durationUs": 200_000,
                        "placement": "in",
                        "fromClipId": "left",
                        "toClipId": "right",
                    }
                ],
            }
        )
