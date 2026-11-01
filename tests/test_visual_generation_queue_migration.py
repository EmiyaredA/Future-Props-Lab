"""Upgrade only an isolated database and preserve existing task/lease snapshots."""

from tests.migration_fixtures import MIGRATIONS, apply_migrations

from db.migrations import runner
from db.migrations.runner import connect_database

INDEX_QUERY = (
    "SELECT name,sql FROM sqlite_master WHERE type='index' "
    "AND tbl_name IN ('visual_generation_tasks','visual_generation_batches')"
)


def test_queue_upgrade_preserves_tasks_batches_ownership_and_constraints(tmp_path, monkeypatch):
    database = tmp_path / "queue-upgrade.db"
    index = next(
        i for i, m in enumerate(MIGRATIONS) if m.migration_id == "0114_visual_generation_queue"
    )
    previous = MIGRATIONS[:index]
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", previous)
        patch.setattr(runner, "LATEST_MIGRATION_ID", previous[-1].migration_id)
        apply_migrations(database)
    with connect_database(database) as db:
        db.execute(
            "INSERT INTO visual_workshop_projects(id,title,kind) VALUES('p','Existing','image')"
        )
        db.execute("""
            INSERT INTO visual_generation_tasks(
                id,project_id,provider_kind,generation_kind,provider_name,model_slug,
                status,revision,provider_task_id,execution_info
            ) VALUES('t','p','senseaudio_image','image','Existing','mock',
                'pending',7,'remote','{"phase":"queued"}')
        """)
        db.execute("""
            INSERT INTO visual_generation_batches(
                id,project_id,grid_size,grid_output,status,child_task_ids,revision
            ) VALUES('b','p',4,'nodes','processing','["t"]',5)
        """)
        db.execute("""
            INSERT INTO runtime_admissions(id,workspace_id,platform_role,task_kind,task_ids)
            VALUES('a','default','member','visual','["t"]')
        """)
        indexes = dict(db.execute(INDEX_QUERY))
        db.commit()
    apply_migrations(database)
    with connect_database(database) as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute(
            "SELECT revision,provider_task_id,execution_info,submitted_at=created_at "
            "FROM visual_generation_tasks WHERE id='t'"
        ).fetchone() == (7, "remote", '{"phase":"queued"}', 1)
        assert db.execute(
            "SELECT revision,child_task_ids,cancelled_count "
            "FROM visual_generation_batches WHERE id='b'"
        ).fetchone() == (5, '["t"]', 0)
        assert db.execute(
            "SELECT task_ids,waiting,queue_task_id,released_at FROM runtime_admissions WHERE id='a'"
        ).fetchone() == ('["t"]', 0, None, None)
        assert dict(db.execute(INDEX_QUERY)) == indexes
        for table in ("visual_generation_tasks", "visual_generation_batches"):
            assert (
                "cancelled"
                in db.execute("SELECT sql FROM sqlite_master WHERE name=?", (table,)).fetchone()[0]
            )
        db.execute("UPDATE visual_generation_tasks SET status='cancelled' WHERE id='t'")
        db.execute(
            "UPDATE visual_generation_batches SET status='cancelled',cancelled_count=1 WHERE id='b'"
        )
        db.execute("""
            INSERT INTO runtime_admissions(
                id,workspace_id,platform_role,task_kind,task_ids,queue_task_id,waiting
            ) VALUES('queued','default','member','visual','["t"]','t',1)
        """)
        db.execute("DELETE FROM visual_generation_tasks WHERE id='t'")
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_admissions WHERE id='queued'"
        ).fetchone() == (0,)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
