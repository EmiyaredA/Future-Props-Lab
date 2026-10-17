import json

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.apps.visual_workshop.generation import generation_task_out
from app.apps.visual_workshop.models import VisualGenerationTask
from app.llm.generation_runtime import GenerationTaskStore
from app.llm.task_execution import TaskExecutionInfo
from app.runtime.time import utc_now
from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database


@pytest.mark.asyncio
async def test_upgrade_preserves_tasks_and_execution_info_survives_store_reload(
    tmp_path, monkeypatch
):
    path = tmp_path / "telemetry.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        db.execute("INSERT INTO visual_workshop_projects (id,title,kind) VALUES ('p','P','video')")
        db.execute(
            "INSERT INTO visual_generation_tasks (id,project_id,provider_kind,"
            "generation_kind,provider_name,model_slug,status,provider_task_id) VALUES "
            "('t','p','zealman_video','video','Z','u17','pending','upstream')"
        )
        old = db.execute("SELECT * FROM visual_generation_tasks").fetchone()
        db.commit()
    apply_migrations(path)
    with connect_database(path) as db:
        row = db.execute("SELECT * FROM visual_generation_tasks").fetchone()
        assert row[:-1] == old and row[-1] is None
        for table in ["model_test_generation_tasks", "model_inference_tasks"]:
            assert "execution_info" in [r[1] for r in db.execute(f"PRAGMA table_info({table})")]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    store = GenerationTaskStore(
        session_factory=sessions,
        task_type=VisualGenerationTask,
        active_statuses={"pending", "processing"},
        task_subject="test",
    )
    info = TaskExecutionInfo(
        phase="running", step=8, total_steps=10, node_id="7", updated_at=utc_now()
    )
    try:
        await store.mark_progress("t", "processing", 0, execution_info=info)
        async with sessions() as session:
            task = await store.load(session, "t")
            assert task.provider_task_id == "upstream" and task.revision == 1
            assert generation_task_out(task).execution_info.step == 8
            assert json.loads(json.dumps(task.execution_info))["total_steps"] == 10
        await store.mark_materializing("t", "https://example.test/final.mp4")
        async with sessions() as session:
            task = await store.load(session, "t")
            assert task.execution_info["phase"] == "finalizing"
            assert task.execution_info["step"] is None
            task.status = "completed"
            await session.commit()
        await store.mark_progress("t", "pending", 0, execution_info=info)
        async with sessions() as session:
            assert (await store.load(session, "t")).status == "completed"
    finally:
        await engine.dispose()
