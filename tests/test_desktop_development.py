"""All development safety checks operate on disposable databases and files."""

import fcntl
import json
import os
import sqlite3

import pytest
from cryptography.fernet import Fernet
from desktop.backend.development_data import (
    baseline_backup,
    check_data,
    inventory,
    offline_backup,
    remember_config,
    verify_lease,
)

from db.migrations.runner import apply_migrations


@pytest.fixture
def data(tmp_path):
    root = tmp_path / "data"
    (root / "backend").mkdir(parents=True)
    (root / "runtime").mkdir()
    (root / "backend/config.toml").write_text(
        f'[security]\nsecrets_key = "{Fernet.generate_key().decode()}"\n'
    )
    apply_migrations(root / "runtime/future-props.db")
    (root / "runtime/.hidden").write_bytes(b"hidden fixture")
    return root


def test_check_is_readonly_and_requires_exact_migrations(data):
    database = data / "runtime/future-props.db"
    before = database.read_bytes()
    check_data(data, True)
    assert database.read_bytes() == before
    # Only this isolated storage fixture may intentionally construct a drift.
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE schema_migrations SET checksum='fixture-drift'")
    with pytest.raises(ValueError, match="迁移"):
        check_data(data, True)


def test_pending_migration_and_missing_live_database_block(data):
    with sqlite3.connect(data / "runtime/future-props.db") as connection:
        connection.execute(
            "DELETE FROM schema_migrations WHERE rowid=(SELECT MAX(rowid) FROM schema_migrations)"
        )
    with pytest.raises(ValueError, match="迁移"):
        check_data(data, True)
    fresh = data.parent / "fresh"
    check_data(fresh)
    with pytest.raises(ValueError):
        check_data(fresh, True)


def test_configuration_last_success_is_private_and_key_cannot_change(data):
    remember_config(data)
    last = data / "development/last-success-config.toml"
    assert last.stat().st_mode & 0o777 == 0o600
    assert last.read_bytes() == (data / "backend/config.toml").read_bytes()
    (data / "backend/config.toml").write_text('[security]\nsecrets_key=""\n')
    with pytest.raises(ValueError, match="密钥"):
        check_data(data)
    assert last.read_bytes() != (data / "backend/config.toml").read_bytes()


def test_backup_verified_once_and_preserves_previous_config(data):
    remember_config(data)
    before = inventory(data / "runtime")
    baseline_backup(data)
    marker = json.loads((data / "development/baseline.json").read_text())
    from pathlib import Path

    backup = Path(marker["backup"])
    assert backup.stat().st_mode & 0o777 == 0o700
    assert inventory(backup / "runtime") == before
    assert json.loads((backup / "manifest.json").read_text()) == before
    baseline_backup(data)
    assert len(list(data.parent.glob("* Development Backup *"))) == 1
    with (data / "backend/config.toml").open("a") as stream:
        stream.write("[limits]\nskill_max_files=22\n")
    prior = offline_backup(data, previous_config=True)
    assert (prior / "backend/config.toml").read_bytes() == (
        data / "development/last-success-config.toml"
    ).read_bytes()
    assert (prior / "backend/config.toml").stat().st_mode & 0o777 == 0o600
    assert inventory(data / "runtime") == before


def test_external_dependency_rejected_without_touching_original(data):
    (data / "runtime/external").symlink_to(data / "backend/config.toml")
    with pytest.raises(ValueError, match="符号链接"):
        offline_backup(data)
    assert (data / "runtime/.hidden").read_bytes() == b"hidden fixture"


def test_lease_is_inherited_but_not_reacquired_by_other_opener(data):
    with (data / "backend.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        duplicate = os.dup(lease.fileno())
        try:
            verify_lease(data, duplicate)
        finally:
            os.close(duplicate)
        with (data / "backend.lock").open("a") as independent:
            with pytest.raises(BlockingIOError):
                verify_lease(data, independent.fileno())
        with (data / "other.lock").open("a") as wrong:
            with pytest.raises(ValueError, match="锁不匹配"):
                verify_lease(data, wrong.fileno())
