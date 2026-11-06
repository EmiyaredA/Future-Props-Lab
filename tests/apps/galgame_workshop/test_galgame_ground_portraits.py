from copy import deepcopy

from scripts.demo.galgame_runaway.ground_portraits import (
    ground_document,
    placement_audit,
)


def sample_document() -> dict:
    return {
        "settings": {
            "characterStage": {
                "anchor": "center",
                "positionPresets": [{"id": "center", "x": 50, "y": 88}],
            },
            "characterStageOverrides": {
                "hero": {
                    "anchor": "topLeft",
                    "positionPresets": [{"id": "left", "x": 25, "y": 92}],
                }
            },
        },
        "characters": [{"id": "hero", "expressions": []}],
        "chapters": [
            {
                "fragments": [
                    {
                        "blocks": [
                            {
                                "id": "line",
                                "type": "dialogue",
                                "characterId": "hero",
                                "text": "不改对白",
                                "expressionId": "smile",
                                "portrait": {
                                    "mode": "stage",
                                    "transform": {"x": 20, "y": 80, "anchor": "center"},
                                },
                            },
                            {
                                "id": "avatar",
                                "type": "dialogue",
                                "characterId": "hero",
                                "text": "头像不属于舞台立绘",
                                "portrait": {
                                    "mode": "dialogueAvatar",
                                    "transform": {"y": 70, "anchor": "center"},
                                },
                            },
                            {
                                "id": "show",
                                "type": "showCharacter",
                                "characterId": "hero",
                                "transform": {"x": 40, "y": 75, "anchor": "center"},
                            },
                            {
                                "id": "cast",
                                "type": "setStageCast",
                                "members": [
                                    {
                                        "characterId": "hero",
                                        "transform": {
                                            "x": 60,
                                            "y": 90,
                                            "anchor": "topLeft",
                                        },
                                    }
                                ],
                            },
                        ]
                    }
                ]
            }
        ],
    }


def test_ground_document_only_changes_stage_vertical_placement() -> None:
    document = sample_document()
    before = deepcopy(document)
    changed = ground_document(document)
    assert changed == {
        "stageAnchors": 2,
        "positionPresets": 2,
        "dialoguePortraits": 1,
        "showCharacterBlocks": 1,
        "stageCastMembers": 1,
    }
    blocks = document["chapters"][0]["fragments"][0]["blocks"]
    assert blocks[0]["text"] == before["chapters"][0]["fragments"][0]["blocks"][0]["text"]
    assert blocks[0]["expressionId"] == "smile"
    assert blocks[0]["portrait"]["transform"] == {
        "x": 20,
        "y": 100.0,
        "anchor": "bottomCenter",
    }
    assert blocks[1] == before["chapters"][0]["fragments"][0]["blocks"][1]
    assert placement_audit(document)["violationCount"] == 0
