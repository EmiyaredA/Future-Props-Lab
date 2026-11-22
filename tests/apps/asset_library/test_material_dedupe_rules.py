"""Protect meaningful slots and aliases while remapping explicit material references."""

from copy import deepcopy

import pytest
from scripts.maintenance.material_dedupe_rules import UnsafeMerge, remap_canvas, remap_card
from scripts.maintenance.visual_material_dedupe import preflight, private_json


def test_remapping_preserves_nodes_prompts_versions_and_distinct_aliases():
    canvas = {
        "revision": 3,
        "nodes": [
            {
                "id": "node",
                "title": "原名称",
                "asset_id": "old",
                "design_card_id": "card",
                "design_card_revision": 4,
                "generation_draft": {
                    "prompt": "<Subject 1> uses [original.png]",
                    "reference_asset_ids": ["old"],
                    "reference_subjects": {"asset:old": "主体1"},
                    "prompt_reference_names": {"old": "原名称"},
                    "design_references": [
                        {"asset_id": "old", "card_id": "card", "card_revision": 4}
                    ],
                },
                "output_version_id": "immutable-version",
            }
        ],
        "edges": [{"source_node_id": "node"}],
    }
    saved = deepcopy(canvas)
    updated = remap_canvas(canvas, {"old": "new"}, {"card": 5})
    assert canvas == saved
    assert updated["nodes"][0]["asset_id"] == "new"
    assert updated["nodes"][0]["title"] == "原名称"
    assert updated["nodes"][0]["output_version_id"] == "immutable-version"
    draft = updated["nodes"][0]["generation_draft"]
    assert draft["prompt"] == saved["nodes"][0]["generation_draft"]["prompt"]
    assert draft["reference_subjects"] == {"asset:new": "主体1"}
    assert draft["design_references"][0]["card_revision"] == 5
    assert updated["edges"] == saved["edges"]


@pytest.mark.parametrize(
    "draft",
    [
        {"reference_asset_ids": ["old", "new"]},
        {"reference_subjects": {"asset:old": "甲", "asset:new": "乙"}},
        {"prompt_reference_names": {"old": "甲", "new": "乙"}},
        {"first_frame_asset_id": "old", "last_frame_asset_id": "new"},
    ],
)
def test_distinct_slots_and_bindings_cannot_be_silently_collapsed(draft):
    with pytest.raises(UnsafeMerge):
        remap_canvas({"nodes": [{"generation_draft": draft}]}, {"old": "new"}, {})


def test_candidate_history_is_not_collapsed():
    with pytest.raises(UnsafeMerge):
        remap_card({"candidate_asset_ids": ["old", "new"]}, {"old": "new"})


def test_frozen_materials_and_active_projects_are_excluded():
    snapshot = {
        "canvases": {},
        "cards": [],
        "usage": {"frozen_asset_ids": ["old"], "active_project_ids": []},
    }
    group = {
        "canonical_id": "new",
        "members": [{"id": "old", "project_id": "p"}, {"id": "new", "project_id": None}],
    }
    with pytest.raises(UnsafeMerge, match="only_frozen"):
        preflight(snapshot, group)
    snapshot["usage"]["active_project_ids"] = ["p"]
    with pytest.raises(UnsafeMerge, match="active_project"):
        preflight(snapshot, group)


def test_recovery_journal_is_private_and_atomically_replaced(tmp_path):
    path = tmp_path / "recovery.json"
    private_json(path, {"step": 1}, exclusive=True)
    private_json(path, {"step": 2})
    assert '"step": 2' in path.read_text()
    assert path.stat().st_mode & 0o077 == 0
    with pytest.raises(FileExistsError):
        private_json(path, {"step": 3}, exclusive=True)
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("new_edit", [False, True])
def test_restore_after_lost_response_never_overwrites_a_new_edit(tmp_path, new_edit):
    import json
    from types import SimpleNamespace
    from unittest.mock import Mock

    from scripts.maintenance.visual_material_dedupe import restore_group

    before = {"revision": 1, "nodes": [{"id": "node", "asset_id": "old", "title": "原名称"}]}
    after = {"revision": 2, "nodes": [{"id": "node", "asset_id": "kept", "title": "原名称"}]}
    current = {"revision": 3, "nodes": [{"id": "node", "asset_id": "old", "title": "原名称"}]}
    if new_edit:
        current["nodes"][0]["title"] = "用户新修改"
    record = {
        "before": {"user_id": "owner"},
        "group": {"content_key": "group"},
        "changes": [
            {"kind": "canvas", "id": "project", "before": before, "after": after, "intended": after}
        ],
        "state": "completed",
    }
    private_json(tmp_path / "recovery.json", record)

    def model(value):
        return SimpleNamespace(model_dump=lambda **_options: deepcopy(value))

    write = Mock(side_effect=AssertionError("must not repeat or overwrite a restore"))
    client = SimpleNamespace(
        automation=SimpleNamespace(capabilities=lambda: SimpleNamespace(user_id="owner")),
        files=SimpleNamespace(
            get_file_content_audit=lambda **_options: model(
                {"groups": [{"content_key": "group", "state": "restored"}]}
            )
        ),
        visual=SimpleNamespace(get_canvas=lambda **_options: model(current), put_canvas=write),
    )
    if new_edit:
        with pytest.raises(UnsafeMerge, match="new_changes"):
            restore_group(client, "operation", tmp_path)
    else:
        restore_group(client, "operation", tmp_path)
        saved = json.loads((tmp_path / "recovery.json").read_text())
        assert saved["state"] == "rolled_back"
        assert saved["changes"][0]["restored"]["revision"] == 3
    write.assert_not_called()
