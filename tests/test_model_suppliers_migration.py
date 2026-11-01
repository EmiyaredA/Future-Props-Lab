import sqlite3

import pytest
from tests.migration_fixtures import apply_migrations

from db.migrations import runner
from db.migrations.runner import connect_database


def test_supplier_migration_preserves_existing_catalog_and_restricts_deletion(
    tmp_path, monkeypatch
):
    database = tmp_path / "supplier-upgrade.db"
    with monkeypatch.context() as historical:
        historical.setattr(
            runner,
            "MIGRATIONS",
            runner.MIGRATIONS[
                : next(
                    index
                    for index, migration in enumerate(runner.MIGRATIONS)
                    if migration.migration_id == "r0055_model_suppliers"
                )
            ],
        )
        apply_migrations(database)
    with connect_database(database) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(
            "INSERT INTO model_providers (id, workspace_id, name, kind, base_url, "
            "api_key_ciphertext, enabled, sort_order) VALUES "
            "('p', 'default', 'gateway', 'openai', 'https://example.test', "
            "'ciphertext-fixture', 1, 3)"
        )
        connection.execute(
            "INSERT INTO model_entries (id, workspace_id, provider_id, slug, label, "
            "description, capabilities, categories, enabled, sort_order) VALUES "
            "('m', 'default', 'p', 'chat', 'Chat', '', '[\"chat\"]', "
            "'[\"text_generation\"]', 1, 2)"
        )
        before = dict(connection.execute("SELECT * FROM model_providers WHERE id='p'").fetchone())
        model_before = dict(
            connection.execute("SELECT * FROM model_entries WHERE id='m'").fetchone()
        )
        connection.commit()
    apply_migrations(database)
    with connect_database(database) as connection:
        connection.row_factory = sqlite3.Row
        after = dict(connection.execute("SELECT * FROM model_providers WHERE id='p'").fetchone())
        assert after.pop("supplier_id") is None
        assert after == before
        assert (
            dict(connection.execute("SELECT * FROM model_entries WHERE id='m'").fetchone())
            == model_before
        )
        assert connection.execute("SELECT count(*) FROM model_suppliers").fetchone()[0] == 0
        connection.execute(
            "INSERT INTO model_suppliers (id, workspace_id, name) "
            "VALUES ('s', 'default', 'Supplier')"
        )
        connection.execute("UPDATE model_providers SET supplier_id='s' WHERE id='p'")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM model_suppliers WHERE id='s'")
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
