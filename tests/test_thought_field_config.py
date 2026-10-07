"""Field settings use public APIs and isolated migration fixtures."""

import io
import json
import zipfile
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from tests.test_thought_multitable import ROOT, setup

from app.apps.thought_workshop.archive_structure import convert_v3_folders_to_notes
from app.apps.thought_workshop.multitable.formatting import format_value
from app.apps.thought_workshop.multitable.schemas import FieldSpec
from app.main import app
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database


@pytest.mark.parametrize(
    "pattern,expected",
    [
        ("YYYY-MM-DD", "2026-10-04"),
        ("YYYY/MM/DD", "2026/10/04"),
        ("YYYY.MM.DD", "2026.10.04"),
        ("YYYY年M月D日", "2026年10月4日"),
        ("DD/MM/YYYY", "04/10/2026"),
        ("MM/DD/YYYY", "10/04/2026"),
    ],
)
def test_date_display_without_timezone(pattern, expected):
    field = FieldSpec(
        id="date", name="日期", type="date", position=1, config={"date_format": pattern}
    )
    assert format_value(field, "2026-10-04") == expected


@pytest.mark.parametrize(
    "value,places,grouping,expected",
    [
        (12345.6789, 2, True, "12,345.68"),
        (-1.235, 2, False, "-1.24"),
        (0.0000001, None, True, "0.0000001"),
        (1e30, 2, False, "1000000000000000000000000000000.00"),
    ],
)
def test_number_formatting_keeps_precision(value, places, grouping, expected):
    field = FieldSpec(
        id="number",
        name="数字",
        type="number",
        position=1,
        config={"decimal_places": places, "use_grouping": grouping},
    )
    assert format_value(field, value) == expected


@pytest.mark.asyncio
async def test_display_configuration_preserves_cells_csv_history_and_conflicts():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note, base, _, table = await setup(c)
        table["name"] = f"显示配置 {note['id']}"
        record_id = str(uuid4())
        number = {
            "id": str(uuid4()),
            "name": "预算",
            "type": "number",
            "position": 4,
            "options": [],
        }
        table["fields"].append(number)
        date_id = table["fields"][2]["id"]
        values = {table["fields"][0]["id"]: "任务", date_id: "2026-10-04", number["id"]: 12345.6789}
        response = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {"op": "table.put", "table": table},
                    {
                        "op": "records.put",
                        "table_id": table["id"],
                        "records": [{"id": record_id, "position": 0, "values": values}],
                    },
                ],
            },
        )
        assert response.status_code == 200, response.text
        table["fields"][2]["config"] = {"date_format": "YYYY年M月D日"}
        number["config"] = {"decimal_places": 2, "use_grouping": True}
        body = {"expected_revision": 1, "operations": [{"op": "table.put", "table": table}]}
        response = await c.post(base + "/operations", json=body)
        assert response.status_code == 200, response.text
        assert (await c.post(base + "/operations", json=body)).status_code == 409
        query = (await c.post(base + f"/tables/{table['id']}/query", json={})).json()
        assert query["items"][0]["values"] == values
        historical = (await c.get(base + "/history/2")).json()
        assert historical["tables"][0]["fields"][-1]["config"] == number["config"]
        csv = await c.post(base + f"/tables/{table['id']}/csv-export", json={})
        assert csv.status_code == 200, csv.text
        assert "12345.6789" in csv.text and "2026-10-04" in csv.text
        static = await c.get(
            ROOT + f"/notes/{note['id']}/export", params={"expected_revision": 2, "format": "md"}
        )
        assert static.status_code == 200, static.text
        assert "12,345.68" in static.text and "2026年10月4日" in static.text
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        imported = await c.post(
            ROOT + "/imports",
            files={"upload": ("configured.zip", backup.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        for imported_id in imported.json()["note_ids"]:
            copied = await c.get(ROOT + f"/notes/{imported_id}/multitable")
            if copied.status_code != 200:
                continue
            copied_table = copied.json()["tables"][0]
            if copied_table["name"] == table["name"] and len(copied_table["fields"]) == 5:
                copied_number = copied_table["fields"][-1]
                assert copied_number["config"] == number["config"]
                assert copied_number["id"] != number["id"]
                break
        else:
            pytest.fail("configured table missing after version 8 import")
        assert (
            await c.post(base + "/history/1/restore", json={"expected_revision": 2})
        ).status_code == 200
        restored = (await c.get(base)).json()
        assert restored["tables"][0]["fields"][-1]["config"] == {}
        assert (await c.post(base + f"/tables/{table['id']}/query", json={})).json()["items"][0][
            "values"
        ] == values


@pytest.mark.asyncio
async def test_invalid_configs_and_referenced_options_do_not_write():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        _, base, _, table = await setup(c)
        record_id = str(uuid4())
        for config in [
            {"extra": True},
            {"date_format": "YY"},
            {"decimal_places": 9},
            {"decimal_places": True},
            {"use_grouping": "yes"},
            {"decimal_places": 2},
        ]:
            draft = deepcopy(table)
            draft["fields"][2]["config"] = config
            response = await c.post(
                base + "/operations",
                json={"expected_revision": 0, "operations": [{"op": "table.put", "table": draft}]},
            )
            assert response.status_code == 422, response.text
        option = table["fields"][1]["options"][0]
        response = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {
                        "op": "records.put",
                        "table_id": table["id"],
                        "records": [
                            {
                                "id": record_id,
                                "position": 0,
                                "values": {table["fields"][1]["id"]: option["id"]},
                            }
                        ],
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        draft = deepcopy(table)
        draft["fields"][1]["options"] = draft["fields"][1]["options"][1:]
        preview = await c.post(base + "/conversion-preview", json={"table": draft})
        assert preview.status_code == 200 and not preview.json()["valid"]
        assert "仍被记录引用" in preview.json()["errors"][0]["message"]
        assert (
            await c.post(
                base + "/operations",
                json={"expected_revision": 1, "operations": [{"op": "table.put", "table": draft}]},
            )
        ).status_code == 422
        table["views"][0]["config"]["filters"] = [
            {
                "field_id": table["fields"][1]["id"],
                "operator": "contains",
                "value": table["fields"][1]["options"][1]["id"],
            }
        ]
        assert (
            await c.post(
                base + "/operations",
                json={"expected_revision": 1, "operations": [{"op": "table.put", "table": table}]},
            )
        ).status_code == 200
        draft = deepcopy(table)
        draft["fields"][1]["options"].pop(1)
        assert (
            await c.post(base + "/conversion-preview", json={"table": draft})
        ).status_code == 422
        assert (await c.get(base)).json()["revision"] == 2


@pytest.mark.asyncio
async def test_version_seven_missing_metadata_normalizes_complete_history():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note, base, _, table = await setup(c)
        for revision in range(2):
            table["name"] = f"兼容测试 {note['id']} {revision}"
            response = await c.post(
                base + "/operations",
                json={
                    "expected_revision": revision,
                    "operations": [{"op": "table.put", "table": table}],
                },
            )
            assert response.status_code == 200, response.text
        payload = (
            await c.get(ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]})
        ).content
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        manifest = json.loads(files["manifest.json"])
        assert manifest["version"] == 8
        assert convert_v3_folders_to_notes(deepcopy(manifest))["version"] == 8
        manifest["version"] = 7

        def legacy(value):
            if isinstance(value, dict):
                for field in value.get("fields", []):
                    field.pop("config", None)
                for child in value.values():
                    legacy(child)
            elif isinstance(value, list):
                for child in value:
                    legacy(child)

        legacy(manifest)
        files["manifest.json"] = json.dumps(manifest).encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        imported = await c.post(
            ROOT + "/imports",
            files={"upload": ("legacy.zip", output.getvalue(), "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        for id in imported.json()["note_ids"]:
            structure = await c.get(ROOT + f"/notes/{id}/multitable")
            if (
                structure.status_code == 200
                and structure.json()["tables"][0]["name"] == table["name"]
            ):
                assert structure.json()["tables"][0]["fields"][0]["config"] == {}
                assert id != note["id"]
                assert (await c.get(ROOT + f"/notes/{id}/multitable/history/1")).status_code == 200
                break
        else:
            pytest.fail("imported table missing")


def test_field_config_migration_preserves_existing_values(tmp_path):
    with connect_database(tmp_path / "field-config.sqlite") as db:
        db.execute("PRAGMA foreign_keys=OFF")
        for migration in MIGRATIONS:
            if migration.migration_id == "0085_thought_field_config":
                break
            db.executescript(migration.sql)
        db.execute(
            "INSERT INTO thought_data_fields(id,table_id,name,type,position,options) "
            "VALUES ('f','t','截止日期','date',2,'[]')"
        )
        db.execute(
            'INSERT INTO thought_data_records(id,table_id,position,"values") '
            "VALUES ('r','t',0,'{\"f\":\"2026-10-04\"}')"
        )
        db.executescript(
            next(m.sql for m in MIGRATIONS if m.migration_id == "0085_thought_field_config")
        )
        assert db.execute("SELECT config FROM thought_data_fields WHERE id='f'").fetchone() == (
            "{}",
        )
        assert db.execute(
            "SELECT \"values\" FROM thought_data_records WHERE id='r'"
        ).fetchone() == ('{"f":"2026-10-04"}',)
