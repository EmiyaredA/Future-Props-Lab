import json
from copy import deepcopy

import httpx
import pytest

from app.main import app
from db.migrations import apply_migrations
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database, ensure_registry, migration_checksum


@pytest.mark.asyncio
async def test_approval_persists_with_cas_legacy_saves_and_output_changes():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "人工通过", "kind": "canvas"}
        )
        base = f"/v1/visual-workshop/projects/{project.json()['id']}"
        state = {
            "revision": 0,
            "edges": [],
            "nodes": [
                {
                    "id": "text",
                    "kind": "text",
                    "title": "台词",
                    "text": "第一版",
                    "position": {"x": 0, "y": 0},
                },
                {"id": "image", "kind": "image", "title": "图片", "position": {"x": 400, "y": 0}},
            ],
        }

        async def save():
            response = await client.put(
                f"{base}/canvas",
                json={
                    "expected_revision": state["revision"],
                    "nodes": state["nodes"],
                    "edges": state["edges"],
                },
            )
            assert response.status_code == 200, response.text
            return response.json()

        state = await save()
        assert all(n["approved"] is False for n in state["nodes"])
        state["nodes"][0]["approved"] = True
        state["nodes"][1]["approved"] = True
        state = await save()
        assert (await client.get(f"{base}/canvas")).json() == state
        stale = deepcopy(state)
        # Old clients omit the field; unrelated metadata edits retain manual approval.
        for n in state["nodes"]:
            n.pop("approved")
            n["title"] += "新名称"
        state = await save()
        assert all(n["approved"] for n in state["nodes"])
        conflict = await client.put(
            f"{base}/canvas",
            json={"expected_revision": stale["revision"], "nodes": stale["nodes"], "edges": []},
        )
        assert conflict.status_code == 409
        state["nodes"][0]["text"] = "新结果"
        state = await save()
        assert state["nodes"][0]["approved"] is False
        # Explicit cancellation is persisted too.
        state["nodes"][1]["approved"] = False
        state = await save()
        assert state["nodes"][1]["approved"] is False

        async def upload():
            result = await client.post(
                "/v1/files",
                data={"project_id": project.json()["id"]},
                files={"upload": ("result.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
            )
            assert result.status_code == 200, result.text
            return result.json()["id"]

        asset = await upload()
        state["nodes"][1]["asset_id"] = asset
        state["nodes"][1]["approved"] = True
        state = await save()
        assert state["nodes"][1]["approved"] is False
        first_output = state["nodes"][1]["final_output_id"]
        state["nodes"][1]["approved"] = True
        state = await save()
        # Re-selecting the same final version preserves approval.
        result = await client.put(
            f"{base}/nodes/image/final-output",
            json={"expected_revision": state["revision"], "output_id": first_output},
        )
        assert result.status_code == 200, result.text
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][1]["approved"] is True
        # A newly registered output requires a new decision, even for the same file.
        result = await client.post(
            f"{base}/nodes/image/outputs",
            json={"expected_revision": state["revision"], "asset_id": asset},
        )
        assert result.status_code == 200, result.text
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][1]["approved"] is False
        state["nodes"][1]["approved"] = True
        state = await save()
        result = await client.put(
            f"{base}/nodes/image/final-output",
            json={"expected_revision": state["revision"], "output_id": first_output},
        )
        assert result.status_code == 200, result.text
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][1]["approved"] is False
        state["nodes"][1]["approved"] = True
        state = await save()
        result = await client.delete(
            f"{base}/nodes/image/outputs/{first_output}",
            params={"expected_revision": state["revision"]},
        )
        assert result.status_code == 200, result.text
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][1]["approved"] is False
        # The operation API uses the same approval field and duplication policy.
        result = await client.post(
            f"{base}/canvas/operations",
            json={
                "expected_revision": state["revision"],
                "request_id": "approve-node",
                "operations": [
                    {
                        "entity": "node",
                        "action": "update",
                        "id": "image",
                        "value": {"approved": True},
                    }
                ],
            },
        )
        assert result.status_code == 200, result.text
        state = result.json()
        assert state["nodes"][1]["approved"] is True
        exported = await client.get(f"{base}/snapshot")
        assert exported.status_code == 200, exported.text
        imported = await client.post(
            "/v1/visual-workshop/projects/snapshot-imports",
            files={"file": ("approval.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        restored = (
            await client.get(
                f"/v1/visual-workshop/projects/{imported.json()['project']['id']}/canvas"
            )
        ).json()
        assert [n["approved"] for n in restored["nodes"]] == [False, True]
        result = await client.post(
            f"{base}/canvas/operations",
            json={
                "expected_revision": state["revision"],
                "request_id": "copy-node",
                "operations": [
                    {
                        "entity": "node",
                        "action": "duplicate",
                        "id": "image",
                        "value": {"id": "copy"},
                    }
                ],
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["nodes"][-1]["approved"] is False


def test_approval_migration_preserves_document_and_is_idempotent(tmp_path):
    path = tmp_path / "approval.db"
    with connect_database(path) as connection:
        ensure_registry(connection)
        for migration in MIGRATIONS[:-1]:
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys=OFF")
            connection.executescript(migration.sql)
            connection.execute(
                "INSERT INTO schema_migrations(migration_id,checksum) VALUES(?,?)",
                (migration.migration_id, migration_checksum(migration)),
            )
            connection.commit()
            connection.execute("PRAGMA foreign_keys=ON")
        connection.execute(
            "INSERT INTO visual_workshop_projects(id,workspace_id,title,kind,status) "
            "VALUES('p','default','旧项目','canvas','draft')"
        )
        nodes = [
            {"id": kind, "kind": kind, "title": kind, "position": {"x": i, "y": 5}}
            for i, kind in enumerate(["text", "image", "video", "audio"])
        ]
        nodes.append({**nodes[0], "id": "approved", "approved": True})
        connection.execute(
            "INSERT INTO visual_canvas_documents(project_id,nodes,edges,revision) "
            "VALUES('p',?,'[]',7)",
            (json.dumps(nodes),),
        )
        connection.commit()
    apply_migrations(path)
    with connect_database(path) as connection:
        content, revision = connection.execute(
            "SELECT nodes,revision FROM visual_canvas_documents"
        ).fetchone()
        assert json.loads(content) == [{"approved": False, **n} for n in nodes]
        assert revision == 7
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    apply_migrations(path)
    with connect_database(path) as connection:
        assert (
            connection.execute("SELECT nodes FROM visual_canvas_documents").fetchone()[0] == content
        )
