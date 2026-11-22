"""Content maintenance writes only reviewed, owner-scoped storyboard documents."""

from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from scripts.demo.visual_storyboard_curate import (
    apply_manifest,
    canvas_digest,
    normalize_shots,
    shot_id,
    validate_entry,
    verify_manifest,
)

from studio.apps.visual_workshop.storyboard.schemas import StoryboardUpdate as OwnedStoryboardUpdate


class Value:
    def __init__(self, value):
        self.value = value

    def model_dump(self, **_):
        return deepcopy(self.value)


class Server:
    def __init__(self, entries, canvases):
        self.entries = entries
        self.canvases = deepcopy(canvases)
        self.documents = {entry["project_id"]: deepcopy(entry["before"]) for entry in entries}
        self.writes = []
        self.lose_confirmation = False
        self.fail_before_commit = False
        self.visual = SimpleNamespace(
            list_projects=lambda: SimpleNamespace(
                items=[SimpleNamespace(id=entry["project_id"]) for entry in entries]
            ),
            get_canvas=lambda project_id: Value(self.canvases[project_id]),
            get_storyboard=lambda project_id: Value(self.documents[project_id]),
            save_storyboard=self.save,
        )
        self.automation = SimpleNamespace(
            capabilities=lambda: SimpleNamespace(user_id="account-one")
        )

    def save(self, *, project_id, body):
        OwnedStoryboardUpdate.model_validate(body.model_dump(mode="json"))
        assert body.expected_revision == self.documents[project_id]["revision"]
        self.writes.append(project_id)
        if self.fail_before_commit:
            raise httpx.ReadError("connection lost")
        self.documents[project_id] = {
            "revision": body.expected_revision + 1,
            "shots": normalize_shots(body.model_dump(mode="json")["shots"]),
        }
        if self.lose_confirmation:
            raise httpx.ReadError("confirmation lost")
        return Value(self.documents[project_id])


def case():
    project_id = str(uuid4())
    nodes = [
        {"id": "image", "kind": "image"},
        {"id": "video", "kind": "video"},
        {"id": "candidate", "kind": "video"},
        {"id": "old-video", "kind": "video"},
        {"id": "character-reference", "kind": "image"},
    ]
    canvas = {"project_id": project_id, "nodes": nodes, "edges": [], "revision": 7}
    entry = {
        "project_id": project_id,
        "title": "current and historical plans",
        "canvas_sha256": canvas_digest(canvas),
        "before": {"revision": 0, "shots": []},
        "records": [
            {
                "key": "current/001",
                "shot": {
                    "id": shot_id(project_id, "current/001"),
                    "title": "001 · current",
                    "image_node_id": "image",
                    "video_node_id": "video",
                },
                "node_ids": ["image", "video", "candidate"],
                "evidence": "Same shot; adopted output and a separate retry node.",
            },
            {
                "key": "historical/001",
                "shot": {
                    "id": shot_id(project_id, "historical/001"),
                    "title": "历史·001",
                    "video_node_id": "old-video",
                },
                "node_ids": ["old-video"],
                "evidence": "Independent old plan, same original shot number.",
            },
        ],
        "excluded": [{"node_id": "character-reference", "reason": "Shared character sheet"}],
    }
    server = Server([entry], {project_id: canvas})
    return server, {"user_id": "account-one", "projects": [entry]}, entry, canvas


def test_merge_current_and_historical_shots_and_resume_without_duplicate_writes(tmp_path):
    server, manifest, entry, _ = case()
    first = apply_manifest(server, manifest, tmp_path)
    second = apply_manifest(server, manifest, tmp_path)
    assert first[0]["status"] == "saved"
    assert second[0]["status"] == "unchanged"
    assert len(server.writes) == 1
    saved = server.documents[entry["project_id"]]["shots"]
    assert [shot["title"] for shot in saved] == ["001 · current", "历史·001"]
    assert saved[0]["image_node_id"] == "image" and saved[0]["video_node_id"] == "video"
    assert len(list(tmp_path.glob("*.json"))) == 1
    assert all(result["verified"] for result in verify_manifest(server, manifest))


def test_omitted_card_list_round_trips_through_actual_owned_write_schema():
    shots = normalize_shots([{"id": str(uuid4()), "title": "No setting cards"}])
    assert shots[0]["card_ids"] == []
    OwnedStoryboardUpdate.model_validate({"expected_revision": 0, "shots": shots})


def test_wrong_account_cannot_write(tmp_path):
    server, manifest, _, _ = case()
    manifest["user_id"] = "another-account"
    with pytest.raises(ValueError, match="account"):
        apply_manifest(server, manifest, tmp_path)
    assert not server.writes


def test_foreign_reference_in_later_project_prevents_entire_batch(tmp_path):
    server, manifest, _, _ = case()
    other, _, entry, canvas = case()
    entry["records"][0]["shot"]["video_node_id"] = "belongs-to-another-project"
    server.entries.append(entry)
    server.canvases[entry["project_id"]] = canvas
    server.documents.update(other.documents)
    manifest["projects"].append(entry)
    with pytest.raises(ValueError, match="project reference"):
        apply_manifest(server, manifest, tmp_path)
    assert not server.writes


def test_preserve_concurrent_storyboard_edit(tmp_path):
    server, manifest, entry, _ = case()
    server.documents[entry["project_id"]] = {
        "revision": 1,
        "shots": [{"id": str(uuid4()), "title": "Someone's new shot"}],
    }
    with pytest.raises(ValueError, match="changed"):
        apply_manifest(server, manifest, tmp_path)
    assert not server.writes


def test_preserve_preexisting_storyboard_shots(tmp_path):
    server, manifest, entry, _ = case()
    previous = {"id": str(uuid4()), "title": "Existing manual shot"}
    entry["before"] = {"revision": 3, "shots": [previous]}
    server.documents[entry["project_id"]] = deepcopy(entry["before"])
    apply_manifest(server, manifest, tmp_path)
    assert server.documents[entry["project_id"]]["shots"][0]["id"] == previous["id"]


def test_lost_confirmation_is_read_back_and_never_replayed(tmp_path):
    server, manifest, _, _ = case()
    server.lose_confirmation = True
    assert apply_manifest(server, manifest, tmp_path)[0]["status"] == "saved"
    assert len(server.writes) == 1


def test_failed_write_preserves_recovery_and_reports_progress(tmp_path):
    server, manifest, _, _ = case()
    server.fail_before_commit = True
    progress = []
    with pytest.raises(httpx.ReadError):
        apply_manifest(server, manifest, tmp_path, lambda items: progress.extend(items))
    assert len(server.writes) == 1
    assert progress[0]["status"] == "needs_review"
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_changed_canvas_requires_new_content_review(tmp_path):
    server, manifest, entry, _ = case()
    server.canvases[entry["project_id"]]["nodes"].pop()
    with pytest.raises(ValueError, match="Canvas changed"):
        apply_manifest(server, manifest, tmp_path)
    assert not server.writes


@pytest.mark.parametrize("problem", ["unaccounted", "duplicate", "unstable", "bad-kind"])
def test_manifest_requires_complete_unambiguous_project_media_accounting(problem):
    _, _, entry, canvas = case()
    if problem == "unaccounted":
        entry["excluded"] = []
    elif problem == "duplicate":
        entry["records"][1]["node_ids"].append("candidate")
    elif problem == "unstable":
        entry["records"][1]["shot"]["id"] = str(uuid4())
    else:
        entry["records"][0]["shot"]["video_node_id"] = "image"
    with pytest.raises(ValueError):
        validate_entry(entry, canvas)
