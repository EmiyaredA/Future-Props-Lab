"""SDK-only voice curation recovers uncertain saves without duplicate uploads."""

import json
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from future_props_lab.generated.models import CardOut
from scripts.demo.visual_character_voices import bind_voices, digest


class FakeClient:
    def __init__(self, root, variant, unrelated, *, uncertain=False):
        self.visual = self.files = self.automation = self
        self.cards = {card.id: card for card in [root, variant, unrelated]}
        self.audio = {}
        self.uploads = self.saves = 0
        self.uncertain = uncertain

    def capabilities(self):
        return SimpleNamespace(user_id="account")

    def list_account_asset_cards(self):
        return list(self.cards.values())

    def get_account_asset_card(self, *, card_id):
        return self.cards[card_id]

    def list_files(self, **_options):
        return SimpleNamespace(items=[])

    def upload_file(self, *, body, files):
        assert body["display_name"]
        self.uploads += 1
        identity = str(uuid4())
        self.audio[identity] = files["upload"][1].read()
        return SimpleNamespace(id=identity)

    @contextmanager
    def preview_file(self, *, asset_id):
        yield SimpleNamespace(iter_bytes=lambda: iter([self.audio[asset_id]]))

    def put_account_asset_card(self, *, card_id, body):
        previous = self.cards[card_id]
        assert body["expected_revision"] == previous.revision
        self.cards[card_id] = previous.model_copy(
            update={
                "voice_asset_id": body["voice_asset_id"],
                "revision": previous.revision + 1,
            }
        )
        self.saves += 1
        if self.uncertain:
            self.uncertain = False
            raise httpx.ReadTimeout("commit confirmation lost")


def fixture(tmp_path, *, uncertain=False):
    root = CardOut(id=str(uuid4()), title="主角色", kind="character", revision=2)
    variant = CardOut(
        id=str(uuid4()), title="变体", kind="character", revision=4, parent_id=root.id
    )
    unrelated = CardOut(id=str(uuid4()), title="无关角色", kind="character", revision=8)
    (tmp_path / "voice.wav").write_bytes(b"reviewed audio")
    manifest = {
        "account_id": "account",
        "characters": [
            {
                "root_card_id": root.id,
                "title": root.title,
                "card_ids": [root.id, variant.id],
                "sample": {
                    "file": "voice.wav",
                    "mime_type": "audio/wav",
                    "sha256": digest(b"reviewed audio"),
                    "source_page": "https://example.test/character",
                },
            }
        ],
    }
    return FakeClient(root, variant, unrelated, uncertain=uncertain), manifest


@pytest.mark.parametrize("uncertain", [False, True])
def test_binding_resumes_and_is_idempotent(tmp_path, uncertain):
    client, manifest = fixture(tmp_path, uncertain=uncertain)
    report, backup = tmp_path / "receipt.json", tmp_path / "backup"
    if uncertain:
        with pytest.raises(httpx.ReadTimeout):
            bind_voices(client, manifest, tmp_path, report, backup)
    result = bind_voices(client, manifest, tmp_path, report, backup)
    assert result["card_count"] == 2 and client.uploads == 1 and client.saves == 2
    before = {key: card.revision for key, card in client.cards.items()}
    bind_voices(client, manifest, tmp_path, report, backup)
    assert {key: card.revision for key, card in client.cards.items()} == before
    assert client.uploads == 1 and client.saves == 2
    assert len(list(backup.glob("*.json"))) == 2
    assert json.loads(report.read_text())["complete"] is True


def test_other_account_and_incomplete_family_never_mutate(tmp_path):
    client, manifest = fixture(tmp_path)
    manifest["account_id"] = "other"
    with pytest.raises(ValueError, match="different account"):
        bind_voices(client, manifest, tmp_path, tmp_path / "receipt", tmp_path / "backup")
    manifest["account_id"] = "account"
    manifest["characters"][0]["card_ids"].pop()
    with pytest.raises(ValueError, match="complete family"):
        bind_voices(client, manifest, tmp_path, tmp_path / "receipt", tmp_path / "backup")
    assert client.uploads == client.saves == 0
