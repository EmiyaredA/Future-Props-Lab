from scripts.galgame_annotation_emotion_sync import build_synced_document


def test_syncs_story_expression_labels_and_normalizes_large_groups() -> None:
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
    assert document["segments"][1]["speaker_id"] == "crowd"
    assert document["segments"][1]["speaker_ids"] == ["crowd"]
    assert audit == {"crowdNormalizedCount": 1, "emotionTaggedCount": 1}
