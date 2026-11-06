from db.migrations.runner import connect_database
from db.migrations.versions.r0044_thought_workshop import SQL
from tests.migration_fixtures import apply_migrations


def test_thought_migration_on_isolated_database(tmp_path):
    path = tmp_path / "migration.db"
    apply_migrations(path)
    apply_migrations(path)
    with connect_database(path) as connection:
        if not connection.execute(
            "SELECT name FROM sqlite_master WHERE name='thought_notes'"
        ).fetchone():
            connection.executescript(SQL)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        names = {row[1] for row in connection.execute("PRAGMA table_info(thought_notes)")}
        assert {"workspace_id", "document", "revision", "deleted_at"} <= names


def test_attachment_version_upgrade_preserves_document_and_revision(tmp_path):
    from db.migrations.versions.r0045_thought_attachments import SQL as upgrade

    # Deliberately run the new SQL independently before it is registered.
    with connect_database(tmp_path / "attachment-migration.db") as connection:
        connection.execute(
            "CREATE TABLE thought_notes (schema_version INTEGER, document TEXT, revision INTEGER)"
        )
        original = '{"type":"doc","content":[{"type":"paragraph"}]}'
        connection.execute("INSERT INTO thought_notes VALUES (1, ?, 7)", (original,))
        connection.executescript(upgrade)
        connection.executescript(upgrade)
        assert tuple(connection.execute("SELECT * FROM thought_notes").fetchone()) == (
            2,
            original,
            7,
        )
