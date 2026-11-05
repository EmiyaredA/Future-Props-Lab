"""Only test-local schemas are constructed directly to verify an explicit service upgrade."""

import sqlite3

from fpl_assets.migrations.registry import MIGRATIONS
from fpl_runtime.migrations import apply, check


def test_prepared_intent_upgrade_preserves_existing_files_pins_and_receipts(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "assets", MIGRATIONS[:1])
    with sqlite3.connect(path) as database:
        database.execute("""INSERT INTO visual_assets (
            id, owner_user_id, original_filename, display_name, storage_key, storage_version,
            media_kind, mime_type, byte_size, revision, created_at, updated_at
        ) VALUES ('asset', 'alpha', 'a.png', 'A', 'key', 2, 'image', 'image/png', 20, 4,
                  '2026-01-01', '2026-01-02')""")
        database.execute("""INSERT INTO asset_reference_sets (
            id, owner_user_id, service_id, resource_kind, resource_id, resource_revision,
            revision, updated_at
        ) VALUES ('set', 'alpha', 'thought', 'note', 'document', 8, 12, '2026-01-02')""")
        database.execute("INSERT INTO asset_reference_pins VALUES ('set', 'asset', 'alpha')")
        database.execute("""INSERT INTO asset_reference_receipts VALUES (
            'receipt', 'alpha', 'thought', 'original-request', 'original-digest', '{}', '2026-01-02'
        )""")
    apply(path, "assets", MIGRATIONS)
    check(path, "assets", MIGRATIONS)
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
        assert database.execute("SELECT id, revision FROM visual_assets").fetchall() == [
            ("asset", 4)
        ]
        assert database.execute(
            "SELECT resource_revision, revision, deleted FROM asset_reference_sets"
        ).fetchall() == [(8, 12, 0)]
        assert database.execute("SELECT * FROM asset_reference_pins").fetchall() == [
            ("set", "asset", "alpha")
        ]
        assert database.execute(
            "SELECT request_id, payload_sha256 FROM asset_reference_receipts"
        ).fetchall() == [("original-request", "original-digest")]
        assert database.execute("SELECT count(*) FROM asset_reference_intents").fetchone() == (0,)
        assert database.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not database.execute("PRAGMA foreign_key_check").fetchall()
