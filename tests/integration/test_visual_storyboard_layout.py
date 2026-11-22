"""Shot grouping preserves business data and produces usable, recoverable layouts."""

from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from scripts.demo.visual_storyboard_curate import canvas_digest, normalize_shots, shot_id
from scripts.demo.visual_storyboard_layout import (
    apply_layout,
    canvas_content,
    layout_canvas,
    presentation,
    validate_layout_entry,
    verify_layout,
)

from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn


class Value:
    def __init__(self, value):
        self.value = value

    def model_dump(self, **_):
        return deepcopy(self.value)


def case():
    project_id = str(uuid4())
    nodes = [
        {
            "id": identity,
            "kind": kind,
            "title": identity,
            "position": {"x": 10, "y": 20},
            "category_id": category,
            "group": group,
            "approved": False,
            "tags": [],
        }
        for identity, kind, category, group in [
            ("image", "image", "storyboard", "001"),
            ("video", "video", "storyboard", "001"),
            ("candidate", "video", "storyboard", "001"),
            ("note", "text", "storyboard", "001"),
            ("solo", "video", None, None),
            ("character", "image", "character", None),
            ("music", "audio", None, None),
        ]
    ]
    nodes[1]["generation_draft"] = {"prompt": "Keep this exact prompt"}
    nodes[1]["asset_id"] = "asset-one"
    nodes[1]["final_output_id"] = "adopted-output"
    nodes[1]["final_version"] = 8
    nodes[1]["approved"] = True
    nodes[3]["text"] = "Original shot notes"
    canvas = {
        "project_id": project_id,
        "revision": 10,
        "nodes": nodes,
        "edges": [
            {"id": "e1", "source_node_id": "music", "target_node_id": "video"},
            {"id": "e2", "source_node_id": "music", "target_node_id": "solo"},
        ],
        "groups": [],
        "categories": [{"id": "character", "name": "人设"}],
        "project_card_ids": [],
    }
    records = []
    for key, ids in [("001", ["image", "video", "candidate"]), ("002", ["solo"])]:
        records.append(
            {
                "key": key,
                "shot": normalize_shots(
                    [
                        {
                            "id": shot_id(project_id, key),
                            "title": key,
                            "image_node_id": "image" if key == "001" else None,
                            "video_node_id": "video" if key == "001" else "solo",
                        }
                    ]
                )[0],
                "node_ids": ids,
                "evidence": "Reviewed shot relationship",
                "historical": key == "002",
            }
        )
    shot_entry = {
        "project_id": project_id,
        "records": records,
        "excluded": [{"node_id": "character", "reason": "Shared character sheet"}],
    }
    after, stats = layout_canvas(canvas, shot_entry)
    entry = {
        "project_id": project_id,
        "before": canvas,
        "after": after,
        "storyboard": {"revision": 1, "shots": [record["shot"] for record in records]},
        "stats": stats,
    }
    return entry, shot_entry


class Server:
    def __init__(self, entry):
        self.current = deepcopy(entry["before"])
        self.board = deepcopy(entry["storyboard"])
        self.writes = 0
        self.lose_confirmation = False
        self.visual = SimpleNamespace(
            get_canvas=lambda **_: Value(self.current),
            get_storyboard=lambda **_: Value(self.board),
            list_projects=lambda: SimpleNamespace(items=[SimpleNamespace(id=entry["project_id"])]),
            put_canvas=self.save,
        )
        self.automation = SimpleNamespace(capabilities=lambda: SimpleNamespace(user_id="owner"))

    def save(self, *, project_id, body):
        assert project_id == self.current["project_id"]
        assert body["expected_revision"] == self.current["revision"]
        self.writes += 1
        self.current.update({key: deepcopy(body[key]) for key in ("nodes", "edges", "groups")})
        self.current["revision"] += 1
        if self.lose_confirmation:
            raise httpx.ReadError("Lost confirmation")
        return Value(self.current)


def test_group_related_media_and_notes_but_keep_shared_music_separate():
    entry, _ = case()
    groups = entry["after"]["groups"]
    shot = next(group for group in groups if group["title"] == "001")
    assert shot["node_ids"] == ["image", "video", "candidate", "note"]
    assert all("music" not in group["node_ids"] for group in groups if group["title"] == "001")
    assert canvas_content(entry["before"]) == canvas_content(entry["after"])
    assert entry["stats"]["single_node_shots"] == 1
    assert all(len(group["node_ids"]) >= 2 for group in groups)


def test_current_historical_and_reference_rectangles_do_not_overlap():
    entry, _ = case()
    boxes = entry["stats"]["rectangles"]
    for index, a in enumerate(boxes):
        for b in boxes[index + 1 :]:
            overlap = (
                a["x"] < b["x"] + b["width"]
                and a["x"] + a["width"] > b["x"]
                and a["y"] < b["y"] + b["height"]
                and a["y"] + a["height"] > b["y"]
            )
            assert not overlap
    assert boxes[1]["y"] > boxes[0]["y"] + boxes[0]["height"]


def test_layout_is_deterministic_and_preserves_node_order():
    entry, shots = case()
    repeated, _ = layout_canvas(entry["before"], shots)
    assert repeated == entry["after"]
    assert [node["id"] for node in repeated["nodes"]] == [
        node["id"] for node in entry["before"]["nodes"]
    ]


def test_apply_then_resume_does_not_duplicate_groups_or_rewrite(tmp_path):
    entry, _ = case()
    server = Server(entry)
    manifest = {"user_id": "owner", "projects": [entry]}
    assert apply_layout(server, manifest, tmp_path)[0]["status"] == "saved"
    assert apply_layout(server, manifest, tmp_path)[0]["status"] == "unchanged"
    assert server.writes == 1
    assert presentation(server.current) == presentation(entry["after"])
    assert verify_layout(server, manifest)[0]["verified"]
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_lost_confirmation_is_read_back_without_replaying(tmp_path):
    entry, _ = case()
    server = Server(entry)
    server.lose_confirmation = True
    assert apply_layout(server, {"user_id": "owner", "projects": [entry]}, tmp_path)
    assert server.writes == 1


@pytest.mark.parametrize("changed", ["position", "prompt", "storyboard"])
def test_concurrent_changes_are_preserved(tmp_path, changed):
    entry, _ = case()
    server = Server(entry)
    if changed == "position":
        server.current["nodes"][0]["position"]["x"] = 999
    elif changed == "prompt":
        server.current["nodes"][1]["generation_draft"]["prompt"] = "New user draft"
    else:
        server.board["revision"] += 1
    with pytest.raises(ValueError, match="changed"):
        apply_layout(server, {"user_id": "owner", "projects": [entry]}, tmp_path)
    assert server.writes == 0


@pytest.mark.parametrize("problem", ["prompt", "edge", "approved", "member", "coordinate"])
def test_reject_nonlayout_edits_and_invalid_groups(problem):
    entry, _ = case()
    after = entry["after"]
    if problem == "prompt":
        after["nodes"][1]["generation_draft"]["prompt"] = "Overwrite user prompt"
    elif problem == "edge":
        after["edges"].pop()
    elif problem == "approved":
        after["nodes"][1]["approved"] = False
    elif problem == "member":
        after["groups"][0]["node_ids"].append("another-project-node")
    else:
        after["nodes"][0]["position"]["x"] = float("nan")
    with pytest.raises(ValueError):
        validate_layout_entry(entry)


def test_empty_project_stays_unchanged():
    project_id = str(uuid4())
    canvas = {"project_id": project_id, "nodes": [], "edges": [], "groups": [], "revision": 0}
    after, stats = layout_canvas(canvas, {"project_id": project_id, "records": [], "excluded": []})
    assert after == canvas and stats["groups"] == 0
    assert canvas_digest(after) == canvas_digest(canvas)


def test_payload_uses_actual_owned_canvas_schema():
    entry, _ = case()
    # This fixture deliberately omits defaults, as a caller of the public API can.
    after = deepcopy(entry["after"])
    after["nodes"][1]["generation_draft"] = None
    after["edges"] = []
    VisualCanvasDocumentPutIn.model_validate(
        {"expected_revision": 10, "nodes": after["nodes"], "edges": [], "groups": after["groups"]}
    )
