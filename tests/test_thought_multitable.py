"""Public API regression tests; all state lives in the isolated test database."""

import csv
import io
import json
import zipfile
from copy import deepcopy

import httpx
import pytest
from tests.thought_helpers import create_note

from website_test_support import app

ROOT = "/v1/thought-workshop"


async def setup(client):
    response = await create_note(client, json={"title": "项目计划", "kind": "multitable"})
    assert response.status_code == 200, response.text
    note = response.json()
    base = ROOT + f"/notes/{note['id']}/multitable"
    structure = (await client.get(base)).json()
    return note, base, structure, structure["tables"][0]


def row(table, id="record1", text="任务"):
    return {"id": id, "position": 0, "values": {table["fields"][0]["id"]: text}}


@pytest.mark.asyncio
async def test_atomic_batches_conversion_query_and_history():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        note, base, structure, table = await setup(client)
        body = {
            "expected_revision": 0,
            "operations": [{"op": "records.put", "table_id": table["id"], "records": [row(table)]}],
        }
        applied = await client.post(base + "/operations", json=body)
        assert applied.status_code == 200, applied.text
        assert applied.json()["structure"]["revision"] == 1
        conflict = await client.post(base + "/operations", json=body)
        assert conflict.status_code == 409, conflict.text
        assert (
            await client.post(base + "/operations", json={"operations": body["operations"]})
        ).status_code == 422
        q = await client.post(base + f"/tables/{table['id']}/query", json={})
        assert q.json()["total"] == 1
        invalid = row(table, "bad")
        invalid["values"][table["fields"][2]["id"]] = "2026-02-30"
        fail = await client.post(
            base + "/operations",
            json={
                "expected_revision": 1,
                "operations": [
                    {
                        "op": "records.put",
                        "table_id": table["id"],
                        "records": [row(table, "valid"), invalid],
                    }
                ],
            },
        )
        assert fail.status_code == 422, fail.text
        assert (await client.post(base + f"/tables/{table['id']}/query", json={})).json()[
            "total"
        ] == 1
        converted = deepcopy(table)
        converted["fields"][0]["type"] = "number"
        assert (
            await client.post(base + "/conversion-preview", json={"table": converted})
        ).status_code == 422
        initial = (await client.get(base + "/history/0")).json()
        assert initial["records"][table["id"]] == []
        restored = await client.post(base + "/history/0/restore", json={"expected_revision": 1})
        assert restored.status_code == 200, restored.text
        assert (await client.post(base + f"/tables/{table['id']}/query", json={})).json()[
            "total"
        ] == 0
        assert (await client.get(ROOT + f"/notes/{note['id']}")).json()["kind"] == "multitable"


@pytest.mark.asyncio
async def test_csv_roundtrip_and_atomic_invalid_import():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        _, base, _, table = await setup(client)
        data = {
            "expected_revision": 0,
            "csv": '名称,日期\n"第一项,含逗号",2026-10-03\n第二项,2026-10-04\n',
            "mapping": [table["fields"][0]["id"], table["fields"][2]["id"]],
        }
        result = await client.post(base + f"/tables/{table['id']}/csv-import", json=data)
        assert result.status_code == 200, result.text
        export = await client.post(base + f"/tables/{table['id']}/csv-export", json={})
        rows = list(csv.reader(io.StringIO(export.text.lstrip("\ufeff"))))
        assert rows[1][0] == "第一项,含逗号"
        data.update(expected_revision=1, csv="名称,日期\n好,2026-10-03\n坏,not-date\n")
        assert (
            await client.post(base + f"/tables/{table['id']}/csv-import", json=data)
        ).status_code == 422
        assert (await client.post(base + f"/tables/{table['id']}/query", json={})).json()[
            "total"
        ] == 2


@pytest.mark.asyncio
async def test_submitted_ids_cannot_replace_another_document_and_reference_nodes():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        note, base, _, table = await setup(client)
        _, other, _, _ = await setup(client)
        result = await client.post(
            other + "/operations",
            json={"expected_revision": 0, "operations": [{"op": "table.put", "table": table}]},
        )
        assert result.status_code == 422, result.text
        ref = {
            "type": "multitableView",
            "attrs": {
                "noteId": note["id"],
                "tableId": table["id"],
                "viewId": table["views"][0]["id"],
            },
        }
        created = await create_note(client, json={"document": {"type": "doc", "content": [ref]}})
        assert created.status_code == 200, created.text
        backlinks = await client.get(ROOT + f"/notes/{note['id']}/backlinks")
        assert created.json()["id"] in [r["id"] for r in backlinks.json()]


@pytest.mark.asyncio
async def test_backup_template_and_copy_remap_all_entities_and_history():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note, base, _, table = await setup(c)
        table["fields"][2]["config"] = {"date_format": "DD/MM/YYYY"}
        assert (
            await c.post(
                base + "/operations",
                json={
                    "expected_revision": 0,
                    "operations": [
                        {"op": "table.put", "table": table},
                        {
                            "op": "records.put",
                            "table_id": table["id"],
                            "records": [row(table, text="备份值")],
                        },
                    ],
                },
            )
        ).status_code == 200
        state_response = await c.get(base + "/history/1")
        assert state_response.status_code == 200, state_response.text
        state = state_response.json()
        t = await c.post(
            ROOT + "/templates",
            json={
                "name": "表格模板",
                "kind": "multitable",
                "document": note["document"],
                "multitable": state,
            },
        )
        assert t.status_code == 200, t.text
        p = (await c.get(ROOT + "/knowledge-bases/" + note["knowledge_base_id"])).json()
        applied = await c.post(
            ROOT + f"/templates/{t.json()['id']}/apply",
            json={
                "expected_revision": 0,
                "knowledge_base_id": p["id"],
                "expected_knowledge_revision": p["revision"],
                "title": "模板实例",
            },
        )
        assert applied.status_code == 200, applied.text
        new_base = ROOT + f"/notes/{applied.json()['id']}/multitable"
        new = (await c.get(new_base)).json()["tables"][0]
        assert new["fields"][2]["config"] == table["fields"][2]["config"]
        assert new["id"] != table["id"] and new["fields"][0]["id"] != table["fields"][0]["id"]
        assert (await c.post(new_base + f"/tables/{new['id']}/query", json={})).json()["total"] == 1
        snapshot = (await c.get(ROOT + f"/notes/{note['id']}/copy-snapshot")).json()
        p = (await c.get(ROOT + "/knowledge-bases/" + p["id"])).json()
        copy = await c.post(
            ROOT + f"/notes/{note['id']}/duplicate",
            json={
                "knowledge_base_id": p["id"],
                "expected_knowledge_revision": p["revision"],
                "source_knowledge_revision": snapshot["knowledge_revision"],
                "expected_revisions": snapshot["revisions"],
                "subtree": False,
            },
        )
        assert copy.status_code == 200, copy.text
        copied = ROOT + f"/notes/{copy.json()['root_id']}/multitable"
        copied_state = (await c.get(copied + "/history/0")).json()
        assert copied_state["records"]
        assert copied_state["tables"][0]["fields"][2]["config"] == {}
        copied_state = (await c.get(copied + "/history/1")).json()
        assert copied_state["tables"][0]["fields"][2]["config"] == table["fields"][2]["config"]
        assert (await c.get(copied)).json()["tables"][0]["fields"][2]["config"] == table["fields"][
            2
        ]["config"]
        backup = await c.get(ROOT + "/backup", params={"knowledge_base_id": p["id"]})
        with zipfile.ZipFile(io.BytesIO(backup.content)) as z:
            manifest = json.loads(z.read("manifest.json"))
        assert manifest["version"] == 9 and note["id"] in manifest["multitables"]
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        for id in imported.json()["note_ids"]:
            n = (await c.get(ROOT + f"/notes/{id}")).json()
            if n["kind"] != "multitable":
                continue
            s = (await c.get(ROOT + f"/notes/{id}/multitable")).json()
            assert s["tables"][0]["id"] not in {table["id"], new["id"]}
            history = await c.get(ROOT + f"/notes/{id}/multitable/history/{s['revision']}")
            assert history.status_code == 200, history.text


@pytest.mark.asyncio
async def test_server_filters_sorting_pagination_conversion_and_static_export():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note, base, _, t = await setup(c)
        f = t["fields"][-1]
        f["type"] = "number"
        config = t["views"][0]["config"]
        config.update(
            filters=[{"field_id": f["id"], "operator": "gte", "value": 3}],
            sorts=[{"field_id": f["id"], "direction": "desc"}],
        )
        rows = [row(t, f"r{i}", f"任务{i}") for i in range(10)]
        for i, r in enumerate(rows):
            r["position"] = i
            r["values"][f["id"]] = i
        result = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {"op": "table.put", "table": t},
                    {"op": "records.put", "table_id": t["id"], "records": rows},
                ],
            },
        )
        assert result.status_code == 200, result.text
        q = await c.post(
            base + f"/tables/{t['id']}/query",
            json={"view_id": t["views"][0]["id"], "offset": 2, "limit": 2},
        )
        assert q.json()["total"] == 7
        assert [r["values"][f["id"]] for r in q.json()["items"]] == [7, 6]
        bad = deepcopy(t)
        bad["fields"][-1]["type"] = "date"
        bad["views"][0]["config"]["filters"] = []
        preview = await c.post(base + "/conversion-preview", json={"table": bad})
        assert preview.status_code == 200 and not preview.json()["valid"]
        assert len(preview.json()["errors"]) == 10
        assert (
            await c.post(
                base + "/operations",
                json={"expected_revision": 1, "operations": [{"op": "table.put", "table": bad}]},
            )
        ).status_code == 422
        ref = {
            "type": "multitableView",
            "attrs": {"noteId": note["id"], "tableId": t["id"], "viewId": t["views"][0]["id"]},
        }
        parent = (
            await create_note(
                c, json={"title": "引用静态导出", "document": {"type": "doc", "content": [ref]}}
            )
        ).json()
        export = await c.get(
            ROOT + f"/notes/{parent['id']}/export", params={"expected_revision": 0, "format": "md"}
        )
        assert export.status_code == 200, export.text
        assert "任务9" in export.text and "任务0" not in export.text
        bad["views"][0]["config"]["filters"] = [
            {"field_id": f["id"], "operator": "gt", "value": None}
        ]
        assert (await c.post(base + "/conversion-preview", json={"table": bad})).status_code == 422


@pytest.mark.asyncio
async def test_capacity_5000_records_50_fields_and_limits():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        _, base, _, t = await setup(c)
        primary = t["fields"][0]
        t["fields"] = [primary] + [
            {"id": f"field{i}", "name": f"字段{i}", "type": "text", "position": i}
            for i in range(1, 50)
        ]
        rows = [
            {
                "id": f"capacity{i}",
                "position": i,
                "values": {f["id"]: f"数据{i}" for f in t["fields"]},
            }
            for i in range(5000)
        ]
        result = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {"op": "table.put", "table": t},
                    {"op": "records.put", "table_id": t["id"], "records": rows},
                ],
            },
        )
        assert result.status_code == 200, result.text
        q = await c.post(base + f"/tables/{t['id']}/query", json={"offset": 4800, "limit": 200})
        assert q.json()["total"] == 5000 and len(q.json()["items"]) == 200
        assert (
            await c.post(base + f"/tables/{t['id']}/query", json={"limit": 201})
        ).status_code == 422
        assert (
            await c.post(
                base + "/operations",
                json={
                    "expected_revision": 1,
                    "operations": [
                        {"op": "records.put", "table_id": t["id"], "records": [row(t, "over")]}
                    ],
                },
            )
        ).status_code == 422
        assert (await c.get(base)).json()["revision"] == 1


@pytest.mark.asyncio
async def test_typed_array_filters_any_groups_search_and_malformed_link_rollback():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        _, base, _, t = await setup(c)
        choice, number = t["fields"][1], t["fields"][3]
        choice["type"], number["type"] = "multi", "number"
        ids = [o["id"] for o in choice["options"]]
        t["fields"].append({"id": "typed-url", "name": "链接", "type": "url", "position": 4})
        view = t["views"][0]
        view["config"].update(
            filter_mode="any",
            filters=[
                {"field_id": choice["id"], "operator": "contains", "value": ids[1]},
                {"field_id": number["id"], "operator": "gt", "value": 8},
            ],
            sorts=[{"field_id": number["id"], "direction": "desc"}],
            group_field_id=number["id"],
        )
        rows = [row(t, f"typed-{i}", f"任务{i}") for i in range(4)]
        for r, options, value in zip(
            rows, [[ids[1], ids[0]], [ids[1]], [], None], [1, 5, 0, 10], strict=True
        ):
            r["values"].update({choice["id"]: options, number["id"]: value})
        result = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {"op": "table.put", "table": t},
                    {"op": "records.put", "table_id": t["id"], "records": rows},
                ],
            },
        )
        assert result.status_code == 200, result.text
        q = await c.post(base + f"/tables/{t['id']}/query", json={"view_id": view["id"]})
        assert q.json()["total"] == 3 and q.json()["groups"] == {"1": 1, "5": 1, "10": 1}
        search = await c.post(base + f"/tables/{t['id']}/query", json={"search": "进行中"})
        assert search.json()["total"] == 2
        view["config"].update(
            filter_mode="all",
            filters=[{"field_id": choice["id"], "operator": "eq", "value": [ids[1], ids[0]]}],
        )
        assert (
            await c.post(
                base + "/operations",
                json={"expected_revision": 1, "operations": [{"op": "table.put", "table": t}]},
            )
        ).status_code == 200
        q = await c.post(base + f"/tables/{t['id']}/query", json={"view_id": view["id"]})
        assert [r["id"] for r in q.json()["items"]] == [rows[0]["id"]]
        bad = row(t, "typed-invalid", "不可部分写入")
        bad["values"]["typed-url"] = "http://[broken"
        response = await c.post(
            base + "/operations",
            json={
                "expected_revision": 2,
                "operations": [
                    {
                        "op": "records.put",
                        "table_id": t["id"],
                        "records": [row(t, "typed-valid"), bad],
                    }
                ],
            },
        )
        assert response.status_code == 422, response.text
        assert (await c.post(base + f"/tables/{t['id']}/query", json={})).json()["total"] == 4
        assert (await c.get(base)).json()["revision"] == 2


@pytest.mark.asyncio
async def test_reconstructs_across_hundred_batch_checkpoint_and_restores_new_revision():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        _, base, _, t = await setup(c)
        for revision in range(101):
            response = await c.post(
                base + "/operations",
                json={
                    "expected_revision": revision,
                    "operations": [
                        {
                            "op": "records.put",
                            "table_id": t["id"],
                            "records": [row(t, "checkpoint-row", f"版本 {revision + 1}")],
                        }
                    ],
                },
            )
            assert response.status_code == 200, response.text
        for revision in [1, 99, 100, 101]:
            response = await c.get(base + f"/history/{revision}")
            assert response.status_code == 200, response.text
            assert (
                response.json()["records"][t["id"]][0]["values"][t["fields"][0]["id"]]
                == f"版本 {revision}"
            )
        restored = await c.post(base + "/history/99/restore", json={"expected_revision": 101})
        assert restored.status_code == 200 and restored.json()["structure"]["revision"] == 102
        assert (await c.get(base + "/history/101")).json()["records"][t["id"]][0]["values"][
            t["fields"][0]["id"]
        ] == "版本 101"
