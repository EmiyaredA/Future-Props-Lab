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
    assert added["transitions"][0] == {**transition, "direction": "left"}
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
        clip for track in split["tracks"] for clip in track["clips"] if clip["id"] == "left"
    )
    right_piece = next(
        clip for track in split["tracks"] for clip in track["clips"] if clip["id"] == "left-right"
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
        clip for track in normalized["tracks"] for clip in track["clips"] if clip["id"] == "right"
    )
    assert right["transitionIn"]["kind"] == "flash"
    assert right["transitionIn"]["durationUs"] == 250_000
    assert [item["id"] for item in normalized["transitions"]] == ["between-1"]
    parsed = parse_timeline_document(normalized)
    assert len(parsed.transitions) == 1
    assert parsed.transitions[0].placement == "between"
    assert parsed.transitions[0].direction == "left"


def test_legacy_wipe_kinds_are_saved_as_canonical_wipe() -> None:
    document = _document()
    document["tracks"][0]["clips"][0]["transitionOut"] = {
        "kind": "wipe-right",
        "durationUs": 200_000,
        "direction": "out",
        "easing": "linear",
    }
    document["transitions"] = [
        {
            "id": "legacy-wipe",
            "kind": "wipe-left",
            "durationUs": 200_000,
            "placement": "between",
            "fromClipId": "left",
            "toClipId": "right",
            "direction": "in",
        }
    ]
    parsed = parse_timeline_document(document)
    transition = parsed.tracks[0].clips[0].transition_out
    assert transition is not None
    assert transition.kind == "wipe"
    assert transition.direction == "right"
    saved = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert saved["tracks"][0]["clips"][0]["transitionOut"]["kind"] == "wipe"
    assert saved["tracks"][0]["clips"][0]["transitionOut"]["direction"] == "right"
    assert saved["transitions"][0]["kind"] == "wipe"
    assert saved["transitions"][0]["direction"] == "left"


def test_audio_crossfade_duration_tracks_overlap_and_zero_overlap_removes_it() -> None:
    document = {
        "tracks": [
            {
                "id": "a1",
                "kind": "audio",
                "name": "音频 1",
                "order": 0,
                "clips": [
                    {
                        "id": "from",
                        "trackId": "a1",
                        "kind": "audio",
                        "name": "前",
                        "assetId": "one",
                        "timelineStartUs": 0,
                        "durationUs": 2_000_000,
                    },
                    {
                        "id": "to",
                        "trackId": "a1",
                        "kind": "audio",
                        "name": "后",
                        "assetId": "two",
                        "timelineStartUs": 1_250_000,
                        "durationUs": 2_000_000,
                    },
                ],
            }
        ],
        "transitions": [
            {
                "id": "audio-seam",
                "kind": "audio-crossfade",
                "durationUs": 10,
                "placement": "between",
                "fromClipId": "from",
                "toClipId": "to",
                "direction": "in",
                "easing": "ease-in-out",
            }
        ],
    }
    parsed = parse_timeline_document(document)
    assert parsed.transitions[0].duration_us == 750_000
    assert parsed.transitions[0].direction == "left"

    trimmed = _apply(
        document,
        {
            "type": "trimClip",
            "clipId": "from",
            "timelineStartUs": 0,
            "durationUs": 1_500_000,
            "sourceInUs": 0,
        },
    )
    assert trimmed["transitions"][0]["durationUs"] == 250_000

    moved = _apply(
        document,
        {
            "type": "moveClip",
            "clipId": "to",
            "trackId": "a1",
            "timelineStartUs": 2_000_000,
        },
    )
    assert moved["transitions"] == []

    restored = _apply(
        moved,
        {
            "type": "moveClip",
            "clipId": "to",
            "trackId": "a1",
            "timelineStartUs": 1_250_000,
        },
        {"type": "addTransition", "transition": document["transitions"][0]},
    )
    assert restored["transitions"][0]["durationUs"] == 750_000


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


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("fade-black", (0, 0, 0)), ("fade-white", (255, 255, 255))],
)
@pytest.mark.parametrize("placement", ["head", "tail", "between"])
def test_color_transitions_cover_the_full_canvas(kind, expected, placement) -> None:
    document = _document()
    if placement == "head":
        document["tracks"][0]["clips"][0]["transitionIn"] = {
            "kind": kind,
            "durationUs": 500_000,
        }
        time_us = 0
    elif placement == "tail":
        document["tracks"][0]["clips"][0]["transitionOut"] = {
            "kind": kind,
            "durationUs": 500_000,
        }
        time_us = 999_999
    else:
        document["transitions"] = [
            {
                "id": "color-seam",
                "kind": kind,
                "durationUs": 1_000_000,
                "placement": "between",
                "fromClipId": "left",
                "toClipId": "right",
            }
        ]
        time_us = 1_000_000
    renderer = TimelineFrameRenderer(
        parse_timeline_document(document),
        FrameSource(
            image_for_clip=lambda clip, _time: Image.new(
                "RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue"
            ),
            font_for_clip=lambda _clip: None,
        ),
    )
    assert renderer.render(time_us).getpixel((960, 540))[:3] == expected


def test_color_transition_overlay_is_above_every_visual_track() -> None:
    document = _document()
    document["tracks"][0]["order"] = 1
    document["tracks"][0]["clips"][0]["transitionIn"] = {
        "kind": "fade-black",
        "durationUs": 500_000,
    }
    document["tracks"].append(
        {
            "id": "overlay",
            "kind": "visual",
            "name": "上层画面",
            "order": 0,
            "clips": [
                {
                    "id": "overlay-clip",
                    "trackId": "overlay",
                    "kind": "image",
                    "name": "上层",
                    "assetId": "green",
                    "timelineStartUs": 0,
                    "durationUs": 1_000_000,
                }
            ],
        }
    )
    renderer = TimelineFrameRenderer(
        parse_timeline_document(document),
        FrameSource(
            image_for_clip=lambda clip, _time: Image.new(
                "RGBA", (32, 18), "green" if clip.asset_id == "green" else "red"
            ),
            font_for_clip=lambda _clip: None,
        ),
    )
    assert renderer.render(0).getpixel((960, 540))[:3] == (0, 0, 0)


def test_wipe_seam_reveals_incoming_without_transparency_fade() -> None:
    document = parse_timeline_document(
        {
            **_document(),
            "transitions": [
                {
                    "id": "wipe",
                    "kind": "wipe",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                    "direction": "left",
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
    frame = renderer.render(1_000_000)
    assert frame.getpixel((100, 540))[:3] == (255, 0, 0)
    assert frame.getpixel((1800, 540))[:3] == (0, 0, 255)


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
        return Image.new("RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue")

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
        return Image.new("RGBA", (32, 18), "red" if clip.asset_id == "red" else "blue")

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
    with pytest.raises(ValueError):
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


@pytest.mark.parametrize("kind", ["crossfade", "wipe", "zoom", "blur", "flash"])
@pytest.mark.parametrize("reverse_order", [False, True])
def test_chained_transitions_never_rewind_or_sample_a_clip_twice(kind, reverse_order):
    clips = [
        {
            "id": name,
            "name": name,
            "trackId": "v1",
            "kind": "video",
            "assetId": name,
            "timelineStartUs": index * 4_000_000,
            "durationUs": 4_000_000,
        }
        for index, name in enumerate(["a", "b", "c"])
    ]
    transitions = [
        {
            "id": "ab",
            "kind": "crossfade",
            "durationUs": 2_000_000,
            "placement": "between",
            "fromClipId": "a",
            "toClipId": "b",
        },
        {
            "id": "bc",
            "kind": kind,
            "durationUs": 4_000_000,
            "placement": "between",
            "fromClipId": "b",
            "toClipId": "c",
        },
    ]
    document = parse_timeline_document(
        {
            "tracks": [{"id": "v1", "name": "V1", "order": 0, "kind": "visual", "clips": clips}],
            "transitions": list(reversed(transitions)) if reverse_order else transitions,
        }
    )
    seen: list[tuple[str, int]] = []

    def sample(clip, local_us):
        seen.append((clip.id, local_us))
        return None

    renderer = TimelineFrameRenderer(document, FrameSource(sample, lambda _clip: None))
    previous: dict[str, int] = {}
    for time_us in [
        5_900_000,
        6_000_000,
        6_100_000,
        7_900_000,
        8_000_000,
        8_100_000,
        9_900_000,
        10_000_000,
        11_900_000,
    ]:
        seen.clear()
        renderer.render(time_us)
        assert len({clip_id for clip_id, _ in seen}) == len(seen), seen
        for clip_id, local_us in seen:
            assert local_us >= previous.get(clip_id, 0), (time_us, clip_id, previous, seen)
            previous[clip_id] = local_us
        if time_us == 6_000_000:
            assert ("b", 3_000_000) in seen
        if time_us == 11_900_000:
            assert any(clip_id == "c" for clip_id, _ in seen)


def test_incoming_clip_holds_its_last_frame_until_timeline_end():
    document = parse_timeline_document(
        {
            **_document(),
            "transitions": [
                {
                    "id": "ab",
                    "kind": "crossfade",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "left",
                    "toClipId": "right",
                }
            ],
        }
    )
    seen = []
    renderer = TimelineFrameRenderer(
        document, FrameSource(lambda clip, local: seen.append((clip.id, local)), lambda _: None)
    )
    renderer.render(1_900_000)
    assert seen == [("right", 999_999)]
