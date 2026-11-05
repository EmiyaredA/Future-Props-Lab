"""Person fields, row colors and field groups stay inside the existing table document."""

import io
import json
import zipfile
from copy import deepcopy

import httpx
import pytest
from tests.thought_helpers import create_note

from studio.apps.identity.storage.models.accounts import User
from studio.apps.thought_workshop.multitable.schemas import Snapshot
from studio.apps.thought_workshop.multitable.validation import validate_snapshot
from website_test_support import SessionLocal, app

ROOT = "/v1/thought-workshop"


async def seed_member(user_id: str, name: str):
    async with SessionLocal() as session:
        if await session.get(User, user_id) is None:
            session.add(
                User(
                    id=user_id,
                    username=user_id,
                    username_normalized=user_id,
                    display_name=name,
                    password_hash="test",
                )
            )
            await session.flush()
        await session.commit()


async def drop_member(user_id: str):
    async with SessionLocal() as session:
        member = await session.get(User, user_id)
        if member is not None:
            member.status = "disabled"
            await session.commit()


@pytest.mark.asyncio
async def test_people_colors_groups_and_version_eight_backup():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await seed_member("member-a", "甲成员")
        await seed_member("member-b", "乙成员")
        note = (await create_note(client, json={"title": "人员表", "kind": "multitable"})).json()
        base = ROOT + f"/notes/{note['id']}/multitable"
        table = (await client.get(base)).json()["tables"][0]
        person = {
            "id": "person-field",
            "name": "记录人",
            "type": "person",
            "position": len(table["fields"]),
            "options": [],
            "config": {"allow_multiple": True, "default_user_ids": ["member-a"]},
        }
        table["fields"].append(person)
        table["groups"] = [
            {"id": "group-1", "name": "问题", "field_ids": [table["fields"][0]["id"], person["id"]]}
        ]
        table["views"][0]["config"]["color_rules"] = [
            {
                "id": "color-1",
                "field_id": table["fields"][0]["id"],
                "operator": "contains",
                "value": "紧急",
                "color": "#E59B3D",
            }
        ]
        saved = await client.post(
            base + "/operations",
            json={"expected_revision": 0, "operations": [{"op": "table.put", "table": table}]},
        )
        assert saved.status_code == 200, saved.text
        record = {
            "id": "record-1",
            "position": 0,
            "values": {
                table["fields"][0]["id"]: "紧急问题",
                person["id"]: ["member-a", "member-b"],
            },
        }
        written = await client.post(
            base + "/operations",
            json={
                "expected_revision": 1,
                "operations": [{"op": "records.put", "table_id": table["id"], "records": [record]}],
            },
        )
        assert written.status_code == 200, written.text
        page = (await client.post(base + f"/tables/{table['id']}/query", json={})).json()
        assert page["people"] == {"member-a": "甲成员", "member-b": "乙成员"}
        assert page["items"][0]["values"][person["id"]] == ["member-a", "member-b"]
        await drop_member("member-b")
        kept = await client.post(
            base + "/operations",
            json={
                "expected_revision": 2,
                "operations": [{"op": "records.put", "table_id": table["id"], "records": [record]}],
            },
        )
        assert kept.status_code == 200, kept.text
        page = (await client.post(base + f"/tables/{table['id']}/query", json={})).json()
        assert page["people"] == {"member-a": "甲成员"}
        stranger = {
            **record,
            "values": {**record["values"], person["id"]: ["member-a", "member-c"]},
        }
        rejected = await client.post(
            base + "/operations",
            json={
                "expected_revision": 3,
                "operations": [
                    {"op": "records.put", "table_id": table["id"], "records": [stranger]}
                ],
            },
        )
        assert rejected.status_code == 422, rejected.text
        single = {**person, "config": {"default_user_ids": ["member-a", "member-b"]}}
        table["fields"][-1] = single
        invalid_default = await client.post(
            base + "/operations",
            json={"expected_revision": 3, "operations": [{"op": "table.put", "table": table}]},
        )
        assert invalid_default.status_code == 422, invalid_default.text
        table["fields"][-1] = person
        table["groups"] = [
            {"id": "group-1", "name": "问题", "field_ids": ["missing-field", person["id"]]}
        ]
        invalid_group = await client.post(
            base + "/operations",
            json={"expected_revision": 3, "operations": [{"op": "table.put", "table": table}]},
        )
        assert invalid_group.status_code == 422, invalid_group.text
        backup = await client.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        assert manifest["version"] == 9
        legacy = deepcopy(manifest["multitables"][note["id"]]["state"])
        for stored in legacy["tables"]:
            stored.pop("groups")
            for view in stored["views"]:
                view["config"].pop("color_rules")
        validate_snapshot(Snapshot.model_validate(legacy))
        manifest["version"] = 8
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            with zipfile.ZipFile(io.BytesIO(backup.content)) as source:
                for name in source.namelist():
                    if name != "manifest.json":
                        archive.writestr(name, source.read(name))
        imported = await client.post(
            ROOT + "/imports",
            files={"upload": ("legacy.zip", payload.getvalue(), "application/zip")},
        )
        assert imported.status_code == 200, imported.text
