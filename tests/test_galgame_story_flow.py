from __future__ import annotations

from studio.apps.galgame_workshop.schemas import GalgameStoryProject
from studio.apps.galgame_workshop.story.story import build_route_report
from test_galgame_workshop import playable_story


def test_return_to_entry_marks_following_blocks_dead_but_branch_does_not() -> None:
    document = playable_story()
    main = document["chapters"][0]["fragments"][0]
    main["blocks"].append({"id": "after-branch", "type": "narration", "text": "继续"})
    ending = document["chapters"][0]["fragments"][1]
    ending["blocks"] = [
        {"id": "return", "type": "returnToEntry"},
        {"id": "dead-after-return", "type": "narration", "text": "不会执行"},
    ]
    report = build_route_report("project", 1, GalgameStoryProject.model_validate(document))

    dead = [issue for issue in report.errors if issue.code == "dead_blocks"]
    assert [issue.block_id for issue in dead] == ["dead-after-return"]
