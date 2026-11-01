"""Code agent schema upgrades preserve existing Pi conversations and runs."""

from tests.migration_fixtures import MIGRATIONS, apply_migrations, check_migrations

from db.migrations import runner
from db.migrations.runner import connect_database


def test_upgrade_preserves_legacy_conversations_and_runs(tmp_path, monkeypatch):
    database = tmp_path / "code-agents.db"
    index = next(
        i for i, migration in enumerate(MIGRATIONS) if migration.migration_id == "0109_code_agents"
    )
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:index])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[index - 1].migration_id)
        apply_migrations(database)
    with connect_database(database) as connection:
        connection.executescript("""
            INSERT INTO users (id, username, username_normalized, display_name,
                password_hash, status, is_platform_admin, platform_role,
                must_change_password, revision, created_at, updated_at)
            VALUES ('u', 'user', 'user', 'User', 'fixture', 'active', 0, 'member',
                0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO amadeus_conversations
                (id, workspace_id, user_id, title, revision, created_at, updated_at)
            VALUES ('c', 'default', 'u', 'Legacy Pi conversation', 7,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO amadeus_runs
                (id, conversation_id, workspace_id, user_id, model_id, status,
                context_json, references_json, capabilities_json, partial_text,
                heartbeat_at, created_at, updated_at)
            VALUES ('r', 'c', 'default', 'u', 'legacy-model', 'completed',
                '{"legacy":true}', '[]', '{}', 'Original response',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO amadeus_messages
                (id, conversation_id, workspace_id, role, content, references_json,
                created_at, run_id)
            VALUES ('m', 'c', 'default', 'assistant', 'Original response', '[]',
                CURRENT_TIMESTAMP, 'r');
        """)
        tables = ("amadeus_conversations", "amadeus_runs", "amadeus_messages")
        columns = {
            table: [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
            for table in tables
        }
        before = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in tables
        }
        history = connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
    assert apply_migrations(database)[1] is True
    assert check_migrations(database) == MIGRATIONS[-1].migration_id
    assert apply_migrations(database)[1] is False
    with connect_database(database) as connection:
        for table in tables:
            selected = ",".join(columns[table])
            assert (
                connection.execute(f"SELECT {selected} FROM {table} ORDER BY id").fetchall()
                == before[table]
            )
        assert connection.execute(
            "SELECT executor_kind,agent_id FROM amadeus_conversations WHERE id='c'"
        ).fetchone() == ("legacy-pi", None)
        assert connection.execute(
            "SELECT agent_id,agent_model,execution_config FROM amadeus_runs WHERE id='r'"
        ).fetchone() == (None, "", "{}")
        assert (
            connection.execute(
                "SELECT * FROM schema_migrations ORDER BY rowid LIMIT ?", (len(history),)
            ).fetchall()
            == history
        )
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
