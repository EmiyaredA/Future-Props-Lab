import json
from pathlib import Path

from tests.migration_fixtures import MIGRATIONS, apply_migrations

from db.migrations.runner import connect_database, ensure_registry, migration_checksum


def before_outputs(path: Path):
    with connect_database(path) as connection:
        ensure_registry(connection)
        for migration in MIGRATIONS:
            if migration.migration_id == "r0086_visual_node_outputs":
                break
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys=OFF")
            connection.executescript(migration.sql)
            connection.execute(
                "INSERT INTO schema_migrations(migration_id,checksum) VALUES(?,?)",
                (migration.migration_id, migration_checksum(migration)),
            )
            connection.commit()
            connection.execute("PRAGMA foreign_keys=ON")


def test_output_migration_preserves_current_asset_all_linked_history_layout_and_credentials(
    tmp_path,
):
    path = tmp_path / "outputs.db"
    before_outputs(path)
    with connect_database(path) as connection:
        connection.execute(
            "INSERT INTO visual_workshop_projects(id,workspace_id,title,kind,status) "
            "VALUES('p','default','旧项目','canvas','draft')"
        )
        for identity in ["old", "current"]:
            connection.execute(
                "INSERT INTO visual_assets(id,workspace_id,project_id,original_filename,"
                "display_name,storage_key,media_kind,mime_type,byte_size) "
                "VALUES(?, 'default','p','file.png','图',?,'image','image/png',10)",
                (identity, identity),
            )
        nodes = [
            {
                "id": "summer",
                "kind": "image",
                "title": "小夏",
                "position": {"x": 100, "y": 200},
                "asset_id": "current",
                "generation_task_id": "task-new",
            },
            {
                "id": "text",
                "kind": "text",
                "title": "脚本",
                "position": {"x": 0, "y": 0},
                "text": "早安",
            },
            {
                "id": "orphan",
                "kind": "image",
                "title": "无输出",
                "position": {"x": 500, "y": 100},
                "asset_id": None,
            },
        ]
        connection.execute(
            "INSERT INTO visual_canvas_documents(project_id,nodes,edges,revision) "
            "VALUES('p',?,'[]',5)",
            (json.dumps(nodes),),
        )
        connection.execute(
            "INSERT INTO model_providers(id,workspace_id,name,kind,base_url,api_key_ciphertext) VALUES('provider','default','原供应商','senseaudio_image','https://api.example/v1','encrypted-placeholder')"
        )
        connection.execute(
            "INSERT INTO model_entries(id,workspace_id,provider_id,slug,label,capabilities) "
            "VALUES('model','default','provider','old-model','原模型','[\"image_generation\"]')"
        )
        for identity, asset, node_id, created in [
            ("task-old", "old", "summer", "2026-01-01"),
            ("task-new", "current", "summer", "2026-01-02"),
            ("unlinked", "old", None, "2026-01-03"),
        ]:
            connection.execute(
                "INSERT INTO visual_generation_tasks(id,workspace_id,project_id,"
                "provider_id,model_id,"
                "provider_kind,generation_kind,provider_name,model_slug,request_payload,status,"
                "result_asset_id,canvas_node_id,created_at) "
                "VALUES(?, 'default','p','provider','model','senseaudio_image','image',"
                "'原供应商','old-model','{}','completed',?,?,?)",
                (identity, asset, node_id, created),
            )
        connection.commit()
    apply_migrations(path)
    with connect_database(path) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert (
            connection.execute(
                "SELECT api_key_ciphertext FROM model_providers WHERE id='provider'"
            ).fetchone()[0]
            == "encrypted-placeholder"
        )
        saved, revision = connection.execute(
            "SELECT nodes,revision FROM visual_canvas_documents WHERE project_id='p'"
        ).fetchone()
        saved = json.loads(saved)
        assert revision == 5
        assert [node["id"] for node in saved] == [node["id"] for node in nodes]
        assert saved[0]["position"] == nodes[0]["position"] and saved[0]["asset_id"] == "current"
        assert saved[0]["final_version"] == 2
        assert saved[1]["final_version"] == 1 and "final_output_id" not in saved[2]
        outputs = connection.execute(
            "SELECT version,asset_id,is_final,generation_task_id FROM visual_node_outputs "
            "WHERE node_id='summer' ORDER BY version"
        ).fetchall()
        assert outputs == [(1, "old", 0, "task-old"), (2, "current", 1, "task-new")]
        # New provider kinds work, while historical foreign keys keep their original names.
        connection.execute("UPDATE model_providers SET kind='volcengine_image' WHERE id='provider'")
        connection.execute(
            "UPDATE visual_generation_tasks SET provider_kind='volcengine_image' "
            "WHERE id='task-new'"
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
