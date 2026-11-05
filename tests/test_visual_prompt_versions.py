import json
from copy import deepcopy

import httpx
import pytest
from pydantic import ValidationError
from tests.migration_fixtures import MIGRATIONS, apply_migrations

from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_owner
from db.migrations.runner import connect_database, ensure_registry, migration_checksum
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasAudioGenerationDraft,
    VisualCanvasDocumentPutIn,
    VisualCanvasImageGenerationDraft,
    VisualCanvasVideoGenerationDraft,
)
from studio.apps.visual_workshop.snapshot_values import remap_canvas
from studio.contracts.identity.principal import StudioPrincipal

DRAFTS = [
    VisualCanvasImageGenerationDraft,
    VisualCanvasVideoGenerationDraft,
    VisualCanvasAudioGenerationDraft,
]


def variants(prompt="第二版"):
    return {
        "prompt": prompt,
        "prompt_versions": [
            {"id": "one", "name": "v1", "prompt": "第一版"},
            {"id": "two", "name": "v2", "prompt": prompt},
        ],
        "active_prompt_version_id": "two",
    }


@pytest.mark.parametrize("shape", DRAFTS)
def test_legacy_draft_normalizes_without_losing_legacy_update_detection(shape):
    draft = shape(prompt="旧提示词\n<Picture 1>")
    assert "prompt_versions" not in draft.model_fields_set
    assert draft.model_dump()["prompt_versions"] == [
        {"id": "v1", "name": "v1", "prompt": draft.prompt}
    ]
    assert draft.active_prompt_version_id == "v1"
    assert shape.model_validate(draft.model_dump()).prompt == draft.prompt


@pytest.mark.parametrize("shape", DRAFTS)
@pytest.mark.parametrize(
    "invalid", ["empty", "duplicate", "missing", "mismatch", "partial", "limit", "long", "blank"]
)
def test_prompt_version_validation(shape, invalid):
    data = variants()
    if invalid == "empty":
        data["prompt_versions"] = []
    elif invalid == "duplicate":
        data["prompt_versions"][0]["id"] = "two"
    elif invalid == "missing":
        data["active_prompt_version_id"] = "missing"
    elif invalid == "mismatch":
        data["prompt"] = "另一个内容"
    elif invalid == "partial":
        del data["active_prompt_version_id"]
    elif invalid == "limit":
        data["prompt_versions"] = [{"id": str(i), "name": "v", "prompt": ""} for i in range(21)]
    elif invalid == "long":
        data["prompt_versions"][0]["prompt"] = "x" * (
            20001 if shape is VisualCanvasVideoGenerationDraft else 6001
        )
    else:
        data["prompt_versions"][0]["name"] = " "
    with pytest.raises(ValidationError):
        shape.model_validate(data)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["image", "video", "audio"])
async def test_canvas_preserves_variants_on_legacy_put_operations_and_conflict(kind):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "多版本", "kind": "canvas"}
        )
        project_id = project.json()["id"]
        path = f"/v1/visual-workshop/projects/{project_id}/canvas"
        node = {
            "id": "target",
            "kind": kind,
            "title": "目标",
            "position": {"x": 0, "y": 0},
            "generation_draft": variants(),
        }
        response = await client.put(
            path, json={"expected_revision": 0, "nodes": [node], "edges": []}
        )
        assert response.status_code == 200, response.text
        saved = response.json()
        # Legacy clients send an entire generation draft with a single prompt.
        node["generation_draft"] = {"prompt": "旧客户端的新内容"}
        response = await client.put(
            path, json={"expected_revision": saved["revision"], "nodes": [node], "edges": []}
        )
        assert response.status_code == 200, response.text
        draft = response.json()["nodes"][0]["generation_draft"]
        assert draft["active_prompt_version_id"] == "two"
        assert draft["prompt_versions"] == variants("旧客户端的新内容")["prompt_versions"]
        revision = response.json()["revision"]
        conflict = await client.put(
            path, json={"expected_revision": saved["revision"], "nodes": [node], "edges": []}
        )
        assert conflict.status_code == 409
        assert (await client.get(path)).json()["nodes"][0]["generation_draft"] == draft
        # The operation batch protocol also preserves variants on a legacy draft update.
        response = await client.post(
            path + "/operations",
            json={
                "expected_revision": revision,
                "request_id": f"legacy-prompt-{kind}",
                "operations": [
                    {
                        "action": "update",
                        "entity": "node",
                        "id": "target",
                        "value": {"generation_draft": {"prompt": "操作更新"}},
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        saved = response.json()
        assert (
            saved["nodes"][0]["generation_draft"]["prompt_versions"]
            == variants("操作更新")["prompt_versions"]
        )
        # Explicit new-client updates can switch to another version without altering it.
        updated = deepcopy(saved["nodes"])
        updated[0]["generation_draft"].update(active_prompt_version_id="one", prompt="第一版")
        response = await client.put(
            path, json={"expected_revision": saved["revision"], "nodes": updated, "edges": []}
        )
        assert response.status_code == 200, response.text
        assert response.json()["nodes"][0]["generation_draft"]["prompt"] == "第一版"
        exported = await client.get(f"/v1/visual-workshop/projects/{project_id}/snapshot")
        assert exported.status_code == 200, exported.text
        imported = await client.post(
            "/v1/visual-workshop/projects/snapshot-imports",
            files={"file": ("prompts.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        restored = await client.get(
            f"/v1/visual-workshop/projects/{imported.json()['project']['id']}/canvas"
        )
        assert (
            restored.json()["nodes"][0]["generation_draft"]
            == response.json()["nodes"][0]["generation_draft"]
        )
        # Invalid new data must fail at the HTTP boundary, before modifying the canvas.
        updated[0]["generation_draft"]["prompt"] = "不匹配"
        invalid = await client.put(
            path,
            json={"expected_revision": response.json()["revision"], "nodes": updated, "edges": []},
        )
        assert invalid.status_code == 422


def test_prompt_migration_preserves_drafts_layout_and_is_applied_once(tmp_path):
    path = tmp_path / "prompts.db"
    with connect_database(path) as connection:
        ensure_registry(connection)
        prompt_index = next(
            i
            for i, item in enumerate(MIGRATIONS)
            if item.migration_id == "r0089_visual_prompt_versions"
        )
        for migration in MIGRATIONS[:prompt_index]:
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
            "VALUES('p','default','提示词','canvas','draft')"
        )
        nodes = [
            {
                "id": kind,
                "kind": kind,
                "title": kind,
                "position": {"x": 123, "y": 456},
                "generation_draft": {"prompt": "旧提示词\n<Picture 1>", "model_id": "saved-model"},
            }
            for kind in ["image", "video", "audio"]
        ] + [
            {"id": "text", "kind": "text", "text": "文本节点"},
            {"id": "empty", "kind": "image", "generation_draft": None},
            {"id": "new", "kind": "audio", "generation_draft": variants()},
        ]
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
        saved = json.loads(content)
        assert revision == 7
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert saved[3:] == [{**node, "approved": False} for node in nodes[3:]]
        for before, after in zip(nodes[:3], saved[:3], strict=True):
            assert after["position"] == before["position"]
            assert after["generation_draft"]["model_id"] == "saved-model"
            assert after["generation_draft"]["prompt_versions"] == [
                {"id": "v1", "name": "v1", "prompt": "旧提示词\n<Picture 1>"}
            ]
    apply_migrations(path)
    with connect_database(path) as connection:
        assert (
            connection.execute("SELECT nodes FROM visual_canvas_documents").fetchone()[0] == content
        )


def test_snapshot_remaps_shared_mention_names_without_changing_version_text():
    draft = {
        **variants(),
        "reference_asset_ids": ["source"],
        "prompt_reference_names": {"source": "舞蹈参考.png"},
    }
    canvas = VisualCanvasDocumentPutIn(
        expected_revision=0,
        nodes=[
            {
                "id": "target",
                "kind": "video",
                "title": "节点",
                "position": {"x": 0, "y": 0},
                "generation_draft": draft,
            }
        ],
    )
    nodes, _, _ = remap_canvas(canvas, {"source": "imported"}, {}, {})
    restored = nodes[0]["generation_draft"]
    assert restored["prompt_reference_names"] == {"imported": "舞蹈参考.png"}
    assert restored["reference_asset_ids"] == ["imported"]
    assert restored["prompt_versions"] == draft["prompt_versions"]
    assert restored["active_prompt_version_id"] == draft["active_prompt_version_id"]


@pytest.mark.asyncio
async def test_prompt_versions_cannot_be_read_or_changed_from_other_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "私有提示词", "kind": "canvas"}
        )
        path = f"/v1/visual-workshop/projects/{project.json()['id']}/canvas"
        body = {
            "expected_revision": 0,
            "nodes": [
                {
                    "id": "target",
                    "kind": "image",
                    "title": "节点",
                    "position": {"x": 0, "y": 0},
                    "generation_draft": variants(),
                }
            ],
            "edges": [],
        }
        saved = await client.put(path, json=body)
        assert saved.status_code == 200

        async def other_workspace(session: SessionDep):
            bind_owner(session, "other-workspace")
            return StudioPrincipal(
                platform_role="admin",
                user_id="other",
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other",
            )

        app.dependency_overrides[require_studio_auth] = other_workspace
        try:
            assert (await client.get(path)).status_code == 404
            body["expected_revision"] = saved.json()["revision"]
            assert (await client.put(path, json=body)).status_code == 404
        finally:
            app.dependency_overrides.pop(require_studio_auth, None)
