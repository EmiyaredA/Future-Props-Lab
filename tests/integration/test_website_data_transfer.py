"""Isolated file relocation proves origin selection, preservation, locks and failure recovery."""

import fcntl
import json
import tomllib
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from scripts.website import data_transfer as transfer

from db.migrations import apply_migrations


@pytest.fixture
def installation(tmp_path):
    source, project = tmp_path / "desktop", tmp_path / "project"
    (source / "backend/web-access/credentials").mkdir(parents=True)
    (source / "runtime/accounts/user").mkdir(parents=True)
    (source / "runtime/accounts/user/original.png").write_bytes(b"original asset")
    key = Fernet.generate_key().decode()
    (source / "backend/config.toml").write_text(f'[security]\nsecrets_key="{key}"\n')
    (source / "backend/web-access/credentials/host.identity").write_text("test credential")
    (source / "local-models/weights").mkdir(parents=True)
    (source / "local-models/weights/model.bin").write_bytes(b"verified weights")
    apply_migrations(source / "runtime/future-props.db")
    (project / ".runtime").mkdir(parents=True)
    (project / ".runtime/old-development.txt").write_text("keep separately")
    (project / "backend").mkdir()
    (project / "backend/config.toml").write_text("# old development config\n")
    return source, project, project / ".local/transfer", key


def test_authoritative_source_is_copied_without_merging_existing_project_data(installation):
    source, project, report, key = installation
    transfer.transfer(source, project, report)
    assert (source / "runtime/accounts/user/original.png").read_bytes() == b"original asset"
    assert (project / ".runtime/accounts/user/original.png").read_bytes() == b"original asset"
    assert not (project / ".runtime/old-development.txt").exists()
    assert (report / "project-runtime-before/old-development.txt").exists()
    assert (project / ".runtime/local-models/weights/model.bin").read_bytes() == b"verified weights"
    config = tomllib.loads((project / "backend/config.toml").read_text())
    assert config["security"]["secrets_key"] == key
    assert config["storage"]["database_path"] == ".runtime/future-props.db"
    assert config["website"]["public_enabled"] is False
    assert config["website"]["legacy_data_root"] == str(source)
    assert (project / "backend/config.toml").stat().st_mode & 0o777 == 0o600
    assert transfer.inventory(source) == transfer.inventory(report / "desktop-snapshot")
    assert json.loads((report / "result.json").read_text())["original_source_preserved"]


def test_live_source_lock_prevents_all_copying(installation):
    source, project, report, _ = installation
    with (source / "backend.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match="运行实例占用"):
            transfer.transfer(source, project, report)
    assert not (report / "desktop-snapshot").exists()
    assert (project / ".runtime/old-development.txt").exists()


def test_missing_key_refuses_to_replace_project_data(installation):
    source, project, report, _ = installation
    (source / "backend/config.toml").write_text("[security]\n")
    with pytest.raises(ValueError, match="密钥缺失"):
        transfer.transfer(source, project, report)
    assert (project / ".runtime/old-development.txt").exists()
    assert not report.exists()


def test_copy_failure_keeps_original_and_previous_project_data(installation, monkeypatch):
    source, project, report, _ = installation
    original = transfer.copy_tree

    def fail(source_path, target):
        if target.name == "runtime-stage":
            raise OSError("simulated full disk")
        original(source_path, target)

    monkeypatch.setattr(transfer, "copy_tree", fail)
    with pytest.raises(OSError, match="full disk"):
        transfer.transfer(source, project, report)
    assert (source / "runtime/accounts/user/original.png").exists()
    assert (project / ".runtime/old-development.txt").exists()
    assert transfer.inventory(source) == transfer.inventory(report / "desktop-snapshot")


def test_config_publish_failure_restores_previous_runtime_and_config(installation, monkeypatch):
    source, project, report, _ = installation
    original = transfer.copy_file

    def fail(source_path, target):
        if Path(target).name == ".website-config.tmp":
            raise OSError("simulated publication failure")
        return original(source_path, target)

    monkeypatch.setattr(transfer, "copy_file", fail)
    with pytest.raises(OSError, match="publication failure"):
        transfer.transfer(source, project, report)
    assert (project / ".runtime/old-development.txt").exists()
    assert (project / "backend/config.toml").read_text() == "# old development config\n"
    assert transfer.inventory(source) == transfer.inventory(report / "desktop-snapshot")
