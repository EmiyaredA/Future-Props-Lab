from scripts.demo.galgame_runaway.annotation_emotion_sync import (
    build_synced_document,
    sync_story_speakers,
)


def test_syncs_story_expression_labels_without_changing_speakers() -> None:
    annotation = {
        "speakers": [
            {"id": "hero", "name": "主角", "color": "#000000"},
            {"id": "a", "name": "甲", "color": "#111111"},
            {"id": "b", "name": "乙", "color": "#222222"},
            {"id": "c", "name": "丙", "color": "#333333"},
            {"id": "crowd", "name": "众人", "color": "#444444"},
        ],
        "segments": [
            {
                "id": "one",
                "start_ms": 100,
                "end_ms": 200,
                "speaker_id": "hero",
                "speaker_ids": ["hero"],
                "emotion": None,
                "text": "one",
                "language": "ja",
                "localized_texts": [],
                "status": "draft",
            },
            {
                "id": "group",
                "start_ms": 200,
                "end_ms": 300,
                "speaker_id": "hero",
                "speaker_ids": ["hero", "a", "b", "c"],
                "emotion": "旧值",
                "text": "group",
                "language": "ja",
                "localized_texts": [],
                "status": "draft",
            },
        ],
    }
    story = {
        "characters": [
            {
                "id": "hero",
                "expressions": [{"id": "shy", "label": "害羞"}],
            }
        ],
        "chapters": [
            {
                "fragments": [
                    {
                        "blocks": [
                            {
                                "type": "dialogue",
                                "characterId": "hero",
                                "expressionId": "shy",
                                "startMs": 100,
                                "endMs": 200,
                            }
                        ]
                    }
                ]
            }
        ],
    }
    document, audit = build_synced_document(annotation, story)
    assert document["segments"][0]["emotion"] == "害羞"
    assert document["segments"][1]["emotion"] is None
    assert document["segments"][1]["speaker_id"] == "hero"
    assert document["segments"][1]["speaker_ids"] == ["hero", "a", "b", "c"]
    assert audit == {
        "emotionChangedCount": 2,
        "emotionTaggedCount": 1,
        "speakerPreservedCount": 2,
    }


def test_syncs_live_audio_speaker_to_story_without_touching_expression() -> None:
    audio = {
        "speakers": [
            {"id": "kurisu-audio", "name": "牧濑红莉栖"},
            {"id": "luka-audio", "name": "漆原琉华"},
        ],
        "segments": [
            {
                "start_ms": 100,
                "end_ms": 200,
                "speaker_id": "luka-audio",
                "speaker_ids": ["luka-audio"],
            }
        ],
    }
    story = {
        "characters": [
            {
                "id": "kurisu",
                "name": "牧濑红莉栖",
                "expressions": [{"id": "smile", "label": "闭眼微笑"}],
            },
            {
                "id": "luka",
                "name": "漆原琉华",
                "expressions": [{"id": "smile", "label": "睁眼微笑"}],
            },
        ],
        "chapters": [
            {
                "fragments": [
                    {
                        "blocks": [
                            {
                                "id": "perf-cast-0",
                                "type": "setStageCast",
                                "atMs": 100,
                                "members": [
                                    {
                                        "characterId": "kurisu",
                                        "expressionId": "smile",
                                    }
                                ],
                            },
                            {
                                "id": "perf-cast-1",
                                "type": "setStageCast",
                                "atMs": 200,
                                "members": [
                                    {
                                        "characterId": "hero",
                                        "expressionId": "neutral",
                                    },
                                    {
                                        "characterId": "kurisu",
                                        "expressionId": "smile",
                                    },
                                ],
                            },
                            {
                                "id": "line-1",
                                "type": "dialogue",
                                "startMs": 100,
                                "endMs": 200,
                                "characterId": "kurisu",
                                "speakerIds": ["kurisu"],
                                "expressionId": "smile",
                                "text": "等着你哦。",
                            },
                        ]
                    }
                ]
            }
        ],
    }
    document, audit = sync_story_speakers(story, audio)
    dialogue = document["chapters"][0]["fragments"][0]["blocks"][0]
    current_cast = document["chapters"][0]["fragments"][0]["blocks"][0]
    next_cast = document["chapters"][0]["fragments"][0]["blocks"][1]
    dialogue = document["chapters"][0]["fragments"][0]["blocks"][2]
    assert dialogue == {
        "id": "line-1",
        "type": "dialogue",
        "startMs": 100,
        "endMs": 200,
        "characterId": "luka",
        "speakerIds": ["luka"],
        "expressionId": "smile",
        "text": "等着你哦。",
    }
    assert audit["speakerChangedCount"] == 1
    assert audit["speakerChanges"][0]["blockId"] == "line-1"
    assert current_cast["members"][0] == {
        "characterId": "luka",
        "expressionId": "smile",
    }
    assert next_cast["members"][1] == {
        "characterId": "luka",
        "expressionId": "smile",
    }
    assert audit["stageCastChangedCount"] == 2
