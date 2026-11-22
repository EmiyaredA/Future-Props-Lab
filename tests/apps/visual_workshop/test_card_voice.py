"""Character audio, variant creation, CAS, and retired design compatibility."""

import json
import sqlite3
from uuid import uuid4

import pytest
from pydantic import ValidationError

from studio.apps.visual_workshop.creative_ports import CreativeAsset
from studio.apps.visual_workshop.creative_snapshots import import_creative_workflow
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.schemas.creative_workflow import CardData, CardUpdate
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.apps.visual_workshop.storage.migrations.versions.v0018 import SQL
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal


async def test_voice_is_scoped_typed_copied_once_and_revision_checked():
    owner, other = str(uuid4()), str(uuid4())
    image, voice, replacement = [str(uuid4()) for _ in range(3)]
    assets = {
        image: CreativeAsset("image", "image/png", None),
        voice: CreativeAsset("audio", "audio/wav", None),
        replacement: CreativeAsset("audio", "audio/mpeg", None),
    }

    async def inspect(_project, identities):
        return {key: assets[key] for key in identities if key in assets}

    async with SessionLocal() as session:
        workflow = CreativeWorkflow(SqlCreativeRecords(session, owner), inspect)
        parent = await workflow.save_card(
            None,
            CardData(
                title="角色",
                kind="character",
                adopted_asset_id=image,
                voice_asset_id=voice,
            ),
        )
        assert parent.media_projects == {image: None, voice: None}
        variant = await workflow.save_card(
            None,
            CardData(
                title="变体",
                kind="character",
                parent_id=parent.id,
                parent_asset_id=image,
            ),
        )
        assert variant.voice_asset_id == voice
        assert variant.media_projects[voice] is None
        silent = await workflow.save_card(
            None,
            CardData(
                title="独立变体",
                kind="character",
                parent_id=parent.id,
                parent_asset_id=image,
                voice_asset_id=None,
            ),
        )
        assert silent.voice_asset_id is None
        update = CardUpdate(
            **parent.model_dump(exclude={"id", "revision", "media_projects", "source_project_id"}),
            expected_revision=0,
        )
        changed = await workflow.save_card(
            None, update.model_copy(update={"voice_asset_id": replacement}), parent.id
        )
        assert changed.revision == 1
        assert voice not in changed.media_projects
        assert (await workflow.card(None, variant.id)).voice_asset_id == voice
        with pytest.raises(ProjectResourceError) as conflict:
            await workflow.save_card(None, update, parent.id)
        assert conflict.value.status == 409
        for invalid in (image, str(uuid4())):
            with pytest.raises(ProjectResourceError):
                await workflow.save_card(
                    None, CardData(title="错误", kind="character", voice_asset_id=invalid)
                )
        foreign = CreativeWorkflow(SqlCreativeRecords(session, other), inspect)
        with pytest.raises(ProjectResourceError):
            await foreign.card(None, parent.id)
        with pytest.raises(ProjectResourceError):
            await foreign.save_card(
                None,
                CardData(
                    title="越权变体", kind="character", parent_id=parent.id, parent_asset_id=image
                ),
            )


def test_voice_is_character_only_and_retired_fields_are_rejected():
    for kind in ("scene", "prop"):
        with pytest.raises(ValidationError):
            CardData(title="场景", kind=kind, voice_asset_id=str(uuid4()))
    for retired in ("facts", "proposed_design"):
        with pytest.raises(ValidationError):
            CardData.model_validate({"title": "角色", "kind": "character", retired: "旧内容"})


def test_registered_migration_removes_only_retired_fields_and_advances_cas():
    from db.migrations.versions.r0138_visual_card_voice import SQL as WEBSITE_SQL

    assert SQL == WEBSITE_SQL
    with sqlite3.connect(":memory:") as db:
        db.execute("CREATE TABLE visual_asset_cards(id TEXT, revision INTEGER, data JSON)")
        for identity, data in enumerate(
            [
                {
                    "design": "已确认",
                    "facts": "旧依据",
                    "proposed_design": "旧设计",
                    "voice_asset_id": "voice",
                },
                {"design": "已确认", "facts": ""},
                {"design": "已确认"},
            ]
        ):
            db.execute(
                "INSERT INTO visual_asset_cards VALUES (?, 7, ?)", (str(identity), json.dumps(data))
            )
        db.executescript(SQL)
        records = [
            (revision, json.loads(data))
            for revision, data in db.execute(
                "SELECT revision,data FROM visual_asset_cards ORDER BY id"
            )
        ]
        assert [revision for revision, _ in records] == [8, 8, 7]
        assert all("facts" not in data and "proposed_design" not in data for _, data in records)
        assert records[0][1] == {"design": "已确认", "voice_asset_id": "voice"}
        db.executescript(SQL)
        assert [
            row[0] for row in db.execute("SELECT revision FROM visual_asset_cards ORDER BY id")
        ] == [8, 8, 7]


def test_legacy_archive_discards_retired_text_and_remaps_voice():
    card, image, voice = [str(uuid4()) for _ in range(3)]
    new_image, new_voice = str(uuid4()), str(uuid4())
    rows, media, models = import_creative_workflow(
        {
            "asset_cards": [
                {
                    "id": card,
                    "revision": 2,
                    "kind": "character",
                    "title": "角色",
                    "design": "确认",
                    "facts": "旧依据",
                    "proposed_design": "旧设计",
                    "adopted_asset_id": image,
                    "voice_asset_id": voice,
                }
            ]
        },
        str(uuid4()),
        str(uuid4()),
        {image: new_image, voice: new_voice},
    )
    assert media == {new_image: "image", new_voice: "audio"}
    assert not models
    assert rows[0].data["voice_asset_id"] == new_voice
    assert "facts" not in rows[0].data and "proposed_design" not in rows[0].data
    assert new_voice in rows[0].media_projects
