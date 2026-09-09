from db.migrations.runner import connect_database
from db.migrations.versions.r0047_skill_tags import SQL


def test_skill_tags_upgrade_preserves_existing_records(tmp_path):
    # Validate the finalized SQL before registering it in a running installation.
    with connect_database(tmp_path / "skill-tags.db") as connection:
        connection.execute(
            "CREATE TABLE integration_skills (id TEXT PRIMARY KEY, revision INTEGER)"
        )
        connection.execute("INSERT INTO integration_skills VALUES ('existing', 7)")
        connection.executescript(SQL)
        assert tuple(connection.execute("SELECT * FROM integration_skills").fetchone()) == (
            "existing",
            7,
            "[]",
        )
        connection.execute("INSERT INTO integration_skills (id, revision) VALUES ('new', 0)")
        assert (
            connection.execute("SELECT tags FROM integration_skills WHERE id='new'").fetchone()[0]
            == "[]"
        )
