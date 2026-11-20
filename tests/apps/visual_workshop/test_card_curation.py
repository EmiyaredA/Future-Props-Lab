"""A reviewed SDK run resumes after partial failure without duplicating cards."""

import hashlib
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from scripts.curate_visual_design_cards import execute, write


class Snapshot:
    def __init__(self, value):
        self.value = deepcopy(value)

    def __getattr__(self, key):
        return self.value[key]

    def model_dump(self, **_):
        return deepcopy(self.value)


class Media:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_bytes(self):
        yield b"image-b"


class Account:
    def __init__(self):
        self.visual = self
        self.files = self
        self.cards = [
            {
                "id": "main",
                "title": "林夏",
                "kind": "character",
                "design": "常服",
                "adopted_asset_id": "image-a",
                "candidate_asset_ids": [],
                "revision": 0,
                "archived": False,
                "media_projects": {"image-a": None},
            }
        ]
        self.canvas = {
            "revision": 5,
            "nodes": [
                {
                    "id": "old",
                    "kind": "image",
                    "title": "旧人设",
                    "asset_id": "image-b",
                    "final_output_id": "history-final",
                }
            ],
            "edges": [{"id": "edge", "source_node_id": "old", "target_node_id": "shot"}],
            "groups": [],
            "categories": [],
            "project_card_ids": [],
        }
        self.writes = 0
        self.fail_canvas = False

    def list_account_asset_cards(self):
        return [Snapshot(card) for card in self.cards]

    def list_file_folders(self):
        return SimpleNamespace(items=[])

    def list_files(self, **_):
        return SimpleNamespace(items=[])

    def preview_file(self, **_):
        return Media()

    def create_account_asset_card(self, *, body):
        self.writes += 1
        card = {
            **body,
            "id": "variant",
            "revision": 0,
            "archived": False,
            "media_projects": {body["adopted_asset_id"]: None},
        }
        self.cards.append(card)
        return Snapshot(card)

    def regroup_account_asset_cards(self, *, body):
        self.writes += 1
        for card in self.cards:
            if card["id"] in body["variant_ids"]:
                card.update(parent_id="main", parent_asset_id="image-a", revision=1)
        return self.list_account_asset_cards()

    def get_canvas(self, **_):
        return Snapshot(self.canvas)

    def put_canvas(self, *, body, **_):
        if self.fail_canvas:
            self.fail_canvas = False
            raise RuntimeError("response unavailable")
        assert body["expected_revision"] == self.canvas["revision"]
        self.writes += 1
        self.canvas = {**body, "revision": self.canvas["revision"] + 1}
        self.canvas.pop("expected_revision")
        return Snapshot(self.canvas)


def manifest():
    return {
        "asset_hashes": {"image-a": "known", "image-b": hashlib.sha256(b"image-b").hexdigest()},
        "asset_sources": {"image-b": {"source": "library", "project_id": None}},
        "folders": {"character": "characters"},
        "cards": [
            {
                "title": "林夏 · 雨衣",
                "kind": "character",
                "design": "雨衣",
                "images": ["image-b"],
                "parent_title": "林夏",
            }
        ],
        "projects": [
            {
                "id": "project",
                "bindings": {"old": "林夏 · 雨衣"},
                "node_assets": {"old": "image-b"},
                "card_titles": ["林夏 · 雨衣"],
            }
        ],
    }


def test_curation_preserves_outputs_and_resumes_without_duplicates(tmp_path):
    account = Account()
    account.fail_canvas = True
    with pytest.raises(RuntimeError):
        execute(account, manifest(), tmp_path)
    assert len(account.cards) == 2
    assert account.canvas["revision"] == 5
    execute(account, manifest(), tmp_path)
    assert account.canvas["nodes"][0]["final_output_id"] == "history-final"
    assert account.canvas["nodes"][0]["design_card_id"] == "variant"
    assert account.canvas["project_card_ids"] == ["main", "variant"]
    assert account.canvas["edges"][0]["id"] == "edge"
    writes = account.writes
    execute(account, manifest(), tmp_path)
    assert account.writes == writes
    assert json.loads((tmp_path / "receipt.json").read_text())["complete"]
    assert json.loads((tmp_path / "before-canvas-project.json").read_text())["revision"] == 5


def test_curation_stops_if_reviewed_node_image_changed(tmp_path):
    account = Account()
    account.canvas["nodes"][0]["asset_id"] = "edited-after-review"
    with pytest.raises(ValueError, match="Node changed"):
        execute(account, manifest(), tmp_path)
    assert account.canvas["revision"] == 5


def test_receipts_are_private_and_replace_atomically(tmp_path):
    path = tmp_path / "receipt.json"
    write(path, {"before": True})
    write(path, {"after": True})
    assert json.loads(path.read_text()) == {"after": True}
    assert path.stat().st_mode & 0o777 == 0o600
    assert not path.with_suffix(".pending").exists()
