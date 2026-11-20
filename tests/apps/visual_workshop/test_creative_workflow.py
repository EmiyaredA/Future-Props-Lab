"""Exercise file scope, provenance and portable copies of creative project data."""

import json
import sqlite3
import struct
import zipfile
from io import BytesIO
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from studio.apps.visual_workshop.card_generation import CardGeneration
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.generation_common import generation_task_out
from studio.apps.visual_workshop.schemas.card_generation import CardGenerationIn
from studio.apps.visual_workshop.schemas.creative_workflow import CardData, CardUpdate
from studio.apps.visual_workshop.storage.card_generation import SqlCardGeneration
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.contracts.asset_library.file_types import ALLOWED_FILES
from studio.runtime.database.migrations import apply
from studio.runtime.project_errors import ProjectResourceError
from tests.apps.visual_workshop.test_visual_previs import PROJECTS, SCENE
from website_test_support import SessionLocal, app


def glb_with_document(document):
    encoded = json.dumps(document).encode()
    encoded += b" " * (-len(encoded) % 4)
    return struct.pack("<4sIII4s", b"glTF", 2, 20 + len(encoded), len(encoded), b"JSON") + encoded


async def test_script_card_and_model_are_scoped_and_round_trip():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:

        async def create_project():
            response = await client.post(PROJECTS, json={"title": "雨夜来信", "kind": "video"})
            assert response.status_code == 200, response.text
            return response.json()["id"]

        project, other = await create_project(), await create_project()
        path = f"{PROJECTS}/{project}"
        cards, script, previews = f"{path}/asset-cards", f"{path}/script", f"{path}/previs-scenes"
        assert (await client.get(script)).json() == {"revision": 0, "episodes": []}
        episode, scene = str(uuid4()), str(uuid4())
        value = {
            "expected_revision": 0,
            "episodes": [
                {
                    "id": episode,
                    "title": "第一集",
                    "scenes": [
                        {
                            "id": scene,
                            "title": "咖啡馆对话",
                            "heading": "内景 · 咖啡馆 · 夜",
                            "text": "林远：昨晚。",
                        },
                    ],
                }
            ],
        }
        saved = await client.put(script, json=value)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert (await client.put(script, json=value)).status_code == 409
        assert (
            await client.put(
                script, json={**value, "expected_revision": 1, "episodes": value["episodes"] * 2}
            )
        ).status_code == 422

        png = BytesIO()
        Image.new("RGB", (16, 16), "white").save(png, "PNG")

        async def upload(name, data, mime, project_id=project):
            return await client.post(
                "/v1/files", data={"project_id": project_id}, files={"upload": (name, data, mime)}
            )

        image = await upload("信封.png", png.getvalue(), "image/png")
        assert image.status_code in (200, 201), image.text
        image_id = image.json()["id"]
        model = glb_with_document({"asset": {"version": "2.0"}})
        invalid = glb_with_document(
            {"asset": {"version": "2.0"}, "images": [{"uri": "https://example.test/texture.png"}]}
        )
        assert (await upload("external.glb", invalid, "model/gltf-binary")).status_code == 422
        uploaded = await upload("信封.glb", model, "model/gltf-binary")
        assert uploaded.status_code in (200, 201), uploaded.text
        model_id = uploaded.json()["id"]
        assert uploaded.json()["mime_type"] in ALLOWED_FILES[".glb"][1]
        assert (
            await client.get(f"/v1/files/{model_id}/content", params={"project_id": project})
        ).content == model
        assert (
            await client.get(f"/v1/files/{model_id}/content", params={"project_id": other})
        ).status_code == 404

        source = {"scene_id": scene, "revision": 1}
        model_path = f"assets/project-models/{model_id}.glb"
        card = {
            "title": "旧信封",
            "kind": "prop",
            "source": source,
            "facts": "纸质信封",
            "adopted_asset_id": image_id,
            "model_asset_key": model_path,
        }
        created = await client.post(cards, json=card)
        assert created.status_code == 201, created.text
        parent = created.json()["id"]
        assert created.json()["source_project_id"] == project
        assert created.json()["media_projects"] == {image_id: project, model_id: project}
        account_cards = "/v1/visual-workshop/asset-cards"
        assert (await client.get(f"{account_cards}/{parent}")).json() == created.json()
        assert (
            await client.get(f"{PROJECTS}/{other}/asset-cards/{parent}")
        ).json() == created.json()
        project_revision = (await client.get(path)).json()["revision"]
        blocked = await client.delete(path, params={"expected_revision": project_revision})
        assert blocked.status_code == 409 and blocked.json()["code"] == "visual_card_media_in_use"
        assert (
            await client.post(account_cards, json={**card, "adopted_asset_id": str(uuid4())})
        ).status_code == 422
        variant = await client.post(
            cards,
            json={**card, "parent_id": parent, "parent_asset_id": image_id, "title": "雨后信封"},
        )
        assert variant.status_code == 201, variant.text
        assert (
            await client.put(f"{cards}/{parent}", json={**card, "expected_revision": 99})
        ).status_code == 409

        content = {
            **SCENE,
            "script_source": source,
            "document": {
                **SCENE["document"],
                "objects": [
                    {
                        "asset": {
                            "kind": "model",
                            "id": f"project-model-{model_id}",
                            "path": model_path,
                        }
                    }
                ],
            },
        }
        created_scene = await client.post(previews, json=content)
        assert created_scene.status_code == 201, created_scene.text
        assert (
            await client.post(
                previews, json={**content, "script_source": {**source, "revision": 0}}
            )
        ).status_code == 409

        snapshot = await client.get(f"{path}/snapshot")
        assert snapshot.status_code == 200, snapshot.text
        with zipfile.ZipFile(BytesIO(snapshot.content)) as archive:
            assert "asset_cards" not in json.loads(archive.read("project.json"))
        copied = await client.post(
            f"{PROJECTS}/snapshot-imports",
            files={"file": ("copy.zip", snapshot.content, "application/zip")},
        )
        assert copied.status_code in (200, 201), copied.text
        copy_path = f"{PROJECTS}/{copied.json()['project']['id']}"
        copy_cards = (await client.get(f"{copy_path}/asset-cards")).json()
        assert [item["id"] for item in copy_cards if item["title"] == "旧信封"] == [parent]
        assert (await client.get(f"{copy_path}/script")).json() == saved.json()
        copy_preview = (await client.get(f"{copy_path}/previs-scenes")).json()[0]
        copy_scene = (await client.get(f"{copy_path}/previs-scenes/{copy_preview['id']}")).json()
        assert copy_scene["script_source"] == source
        assert copy_scene["document"]["objects"][0]["asset"]["path"] != model_path


async def test_account_card_can_be_created_without_project_and_is_isolated():
    async with SessionLocal() as session:
        owner, other = str(uuid4()), str(uuid4())
        card = await CreativeWorkflow(SqlCreativeRecords(session, owner)).save_card(
            None, CardData(title="共用卡", kind="character")
        )
        assert card.source_project_id is None
        assert (await CreativeWorkflow(SqlCreativeRecords(session, owner)).cards())[0].id == card.id
        assert await CreativeWorkflow(SqlCreativeRecords(session, other)).cards() == []
        with pytest.raises(ProjectResourceError):
            await CreativeWorkflow(SqlCreativeRecords(session, other)).card(None, card.id)
        await session.rollback()
        changed = await CreativeWorkflow(SqlCreativeRecords(session, owner)).save_card(
            None, CardUpdate(title="改过的共用卡", kind="character", expected_revision=0), card.id
        )
        assert changed.revision == 1


async def test_website_card_storage_filters_bulk_queries_and_writes_by_bound_account():
    from sqlalchemy import delete, select, update

    from studio.apps.visual_workshop.storage.models import VisualAssetCard

    owner, other = str(uuid4()), str(uuid4())
    async with SessionLocal() as session:
        own = VisualAssetCard(owner_user_id=owner, data={"kind": "character", "title": "own"})
        foreign = VisualAssetCard(owner_user_id=other, data={"kind": "character", "title": "other"})
        session.add_all([own, foreign])
        await session.commit()
        own_id, foreign_id = own.id, foreign.id
    async with SessionLocal(info={"owner_user_id": owner}) as session:
        selected = await session.scalars(select(VisualAssetCard))
        assert [row.id for row in selected] == [own_id]
        result = await session.execute(
            update(VisualAssetCard).where(VisualAssetCard.id == foreign_id).values(revision=7)
        )
        assert result.rowcount == 0
        result = await session.execute(
            delete(VisualAssetCard).where(VisualAssetCard.id == foreign_id)
        )
        assert result.rowcount == 0
        await session.commit()
    async with SessionLocal(info={"owner_user_id": other}) as session:
        row = await session.get(VisualAssetCard, foreign_id)
        assert row is not None and row.revision == 0


def test_registered_migration_preserves_legacy_card_and_its_media(tmp_path):
    database = tmp_path / "service.db"
    account_migration = next(
        i for i, item in enumerate(MIGRATIONS) if item.id == "0014_visual_account_asset_cards"
    )
    apply(database, "visual", MIGRATIONS[:account_migration])
    project, owner, asset, model, card = (str(uuid4()) for _ in range(5))
    payload = json.dumps(
        {
            "kind": "prop",
            "title": "旧卡",
            "adopted_asset_id": asset,
            "model_asset_key": f"assets/project-models/{model}.glb",
        }
    )
    with sqlite3.connect(database) as db:
        db.execute(
            """INSERT INTO visual_workshop_projects
            (is_official, id, owner_user_id, title, kind, status, revision, created_at, updated_at)
            VALUES (0, ?, ?, '旧项目', 'canvas', 'draft', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (project, owner),
        )
        db.execute(
            "INSERT INTO visual_asset_cards (id, project_id, revision, data) VALUES (?, ?, 5, ?)",
            (card, project, payload),
        )
    apply(database, "visual", MIGRATIONS)
    with sqlite3.connect(database) as db:
        row = db.execute(
            "SELECT id, owner_user_id, project_id, revision, data, media_projects "
            "FROM visual_asset_cards"
        ).fetchone()
        assert row[:-1] == (card, owner, project, 5, payload)
        assert json.loads(row[-1]) == {asset: project, model: project}
        db.execute("DELETE FROM visual_workshop_projects WHERE id = ?", (project,))
        assert db.execute("SELECT id FROM visual_asset_cards").fetchone() == (card,)


async def test_card_generation_replays_exact_paid_task():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(PROJECTS, json={"title": "候选图", "kind": "video"})
        project = response.json()["id"]
        card_response = await client.post(
            f"{PROJECTS}/{project}/asset-cards", json={"title": "许宁", "kind": "character"}
        )
        assert card_response.status_code == 201
        card = card_response.json()
    async with SessionLocal() as session:
        from sqlalchemy import select

        from studio.apps.visual_workshop.storage.models import VisualWorkshopProject

        owner = await session.scalar(
            select(VisualWorkshopProject.owner_user_id).where(VisualWorkshopProject.id == project)
        )
        await session.rollback()
        data = CardGenerationIn(
            request_id=str(uuid4()),
            expected_revision=0,
            model_id="example",
            prompt="三视图",
            size="1440x1024",
        )
        calls = 0

        async def submit(project_id, body, *, on_created):
            nonlocal calls
            calls += 1
            row = VisualGenerationTask(
                owner_user_id=owner,
                project_id=project_id,
                provider_kind="volcengine_image",
                generation_kind=body.kind,
                model_slug="fake",
                provider_name="fake",
                request_payload={},
                status="queued",
            )
            session.add(row)
            await session.flush()
            await on_created(row.id)
            result = generation_task_out(row)
            await session.commit()
            return result

        first = await CardGeneration(
            SqlCardGeneration(session, owner, project, card["id"], data), project, data
        ).run(submit)
        second = await CardGeneration(
            SqlCardGeneration(session, owner, project, card["id"], data), project, data
        ).run(submit)
        assert calls == 1 and first.id == second.id
        cards = await CreativeWorkflow(SqlCreativeRecords(session, owner)).cards(project)
        assert next(item for item in cards if item.id == card["id"]).candidate_task_ids == [
            first.id
        ]
        assert next(item for item in cards if item.id == card["id"]).revision == 1
