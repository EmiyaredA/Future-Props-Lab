"""Mock tool retirement preserves ordinary account, conversation and log data."""

from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database
from studio.runtime.database.orm_base import Base
from website_test_support import app

RETIRED = {
    "model_test_tools",
    "model_test_conversation_tool_bindings",
    "model_test_tool_calls",
}
RETIREMENT_INDEX = next(
    i
    for i, migration in enumerate(MIGRATIONS)
    if migration.migration_id == "0119_retire_model_test_tools"
)


def _tables(connection):
    return {
        row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_retirement_preserves_populated_accounts_messages_and_log_snapshots(tmp_path: Path):
    database = tmp_path / "test-tools-retirement.db"
    prefix = MIGRATIONS[:RETIREMENT_INDEX]
    with (
        patch.object(runner, "MIGRATIONS", prefix),
        patch.object(runner, "LATEST_MIGRATION_ID", prefix[-1].migration_id),
    ):
        apply_migrations(database)
    with connect_database(database) as connection:
        for owner in ("first", "second"):
            connection.execute(
                "INSERT INTO users (id,username,username_normalized,password_hash,created_at,"
                "updated_at) VALUES (?,?,?,'unused','2026-11-02','2026-11-02')",
                (owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO model_test_conversations (id,owner_user_id,title,revision) "
                "VALUES (?,?,'keep conversation',7)",
                (owner, owner),
            )
            connection.execute(
                "INSERT INTO model_test_messages (id,conversation_id,position,turn_id,role,"
                "content,model_slug,status) VALUES (?,?,0,?,'assistant','keep reply',"
                "'test-model','completed')",
                (owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO model_test_attachments (id,conversation_id,message_id,position,"
                "original_filename,storage_key,mime_type,byte_size,width,height) "
                "VALUES (?,?,?,0,'keep.png',?,'image/png',1,1,1)",
                (owner, owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO model_test_tools (id,owner_user_id,name) VALUES (?,?,'mock')",
                (owner, owner),
            )
            connection.execute(
                "INSERT INTO model_test_conversation_tool_bindings "
                "(conversation_id,tool_id,position) VALUES (?,?,0)",
                (owner, owner),
            )
            for source in ("dry_run", "model_test", "realtime_voice"):
                connection.execute(
                    "INSERT INTO model_test_tool_calls (id,owner_user_id,tool_id,conversation_id,"
                    "message_id,source,action_id,tool_name,status) "
                    "VALUES (?,?,?,?,?,?,?,'mock','completed')",
                    (owner + source, owner, owner, owner, owner, source, source),
                )
            connection.execute(
                "INSERT INTO llm_call_logs (id,owner_user_id,call_source,provider_kind,model,"
                "trace_id,request_payload,response_payload,status) "
                "VALUES (?,?,'model_playground','openai','test-model',?,?,?,'success')",
                (owner, owner, owner, '{"tools":["mock"]}', '{"tool_calls":[{"name":"mock"}]}'),
            )
        connection.commit()
        tables_before = _tables(connection)
        preserved = (
            "users",
            "model_test_conversations",
            "model_test_messages",
            "model_test_attachments",
            "llm_call_logs",
        )
        snapshots = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in preserved
        }
        history = connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
    retirement = MIGRATIONS[: RETIREMENT_INDEX + 1]
    expected = retirement[-1].migration_id
    with (
        patch.object(runner, "MIGRATIONS", retirement),
        patch.object(runner, "LATEST_MIGRATION_ID", expected),
    ):
        assert apply_migrations(database) == (expected, True)
        assert apply_migrations(database) == (expected, False)
    with connect_database(database) as connection:
        assert tables_before - _tables(connection) == RETIRED
        assert _tables(connection) - tables_before == set()
        for table, snapshot in snapshots.items():
            assert connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() == snapshot
        assert (
            connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()[
                : len(history)
            ]
            == history
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_fresh_database_and_orm_have_no_mock_tool_tables(tmp_path: Path):
    database = tmp_path / "fresh.db"
    apply_migrations(database)
    with connect_database(database) as connection:
        assert not (RETIRED & _tables(connection))
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    assert not (RETIRED & set(Base.metadata.tables))


@pytest.mark.asyncio
async def test_retired_endpoints_and_openapi_are_removed():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for method, suffix in (
            ("GET", ""),
            ("POST", ""),
            ("GET", "/old"),
            ("PATCH", "/old"),
            ("DELETE", "/old"),
            ("POST", "/old/execute"),
        ):
            response = await client.request(method, f"/v1/model-test/tools{suffix}")
            assert response.status_code == 404
        schema = (await client.get("/openapi.json")).json()
    assert not any(path.startswith("/v1/model-test/tools") for path in schema["paths"])
    assert not any(name.startswith("ModelTestTool") for name in schema["components"]["schemas"])
    for name, fields in {
        "ModelTestConversationPatchIn": {"tool_ids"},
        "ModelTestConversationOut": {"tools"},
        "ModelTestMessageOut": {"tool_calls"},
        "RealtimeVoiceModelOut": {"supports_tools"},
    }.items():
        assert not (fields & set(schema["components"]["schemas"][name]["properties"]))
