from __future__ import annotations

import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from desktop.backend.entry import prepare_configuration

from app.runtime.config import Settings
from fpl_config import ConfigurationError, read_config
from fpl_config.migration import convert_legacy, encode, publish

KEY = Fernet.generate_key().decode()


def test_skill_archive_limit_default_toml_and_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("FPL_SKILL_ARCHIVE_MAX_BYTES", raising=False)
    assert Settings(_config_file=None).fpl_skill_archive_max_bytes == 20 * 1024**2
    config = tmp_path / "skill-limits.toml"
    config.write_text("[limits]\nskill_archive_max_bytes = 15728640\n", encoding="utf-8")
    assert Settings(_config_file=config).fpl_skill_archive_max_bytes == 15 * 1024**2
    monkeypatch.setenv("FPL_SKILL_ARCHIVE_MAX_BYTES", str(25 * 1024**2))
    assert Settings(_config_file=config).fpl_skill_archive_max_bytes == 25 * 1024**2
    assert (
        Settings(
            _config_file=config, _read_environment=False, fpl_secrets_key=KEY
        ).fpl_skill_archive_max_bytes
        == 15 * 1024**2
    )


def legacy(directory: Path, extra: str = "") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "config.toml"
    path.with_name(".env").write_text(f"FPL_SECRETS_KEY={KEY}\n{extra}")
    return path


def convert(path, **kwargs):
    return convert_legacy(path, Settings.validate_file_values, **kwargs)


def test_conversion_round_trip_and_private_backup(tmp_path):
    path = legacy(
        tmp_path,
        "FPL_DATABASE_PATH='目录/数据库.db'\n"
        "CORS_ORIGINS=https://one.example,https://two.example\n"
        "FPL_MCP_STDIO_ALLOWED_COMMANDS='/usr/bin/a:/路径/工具'\n"
        "FPL_AUTH_COOKIE_SECURE=yes\nFPL_SKILL_MAX_FILES=12\n"
        "APP_PORT=9000\nFPL_MANAGEMENT_API_KEY=private-do-not-print\n",
    )
    original = path.with_name(".env").read_bytes()
    assert convert(path)["status"] == "ready"
    assert not path.exists()
    result = convert(path, apply=True)
    assert "private-do-not-print" not in str(result)
    assert Path(result["backup"]).read_bytes() == original
    assert not path.with_name(".env").exists()
    for item in (path, Path(result["backup"])):
        assert item.stat().st_mode & 0o777 == 0o600
    document = tomllib.loads(path.read_text())
    assert document["security"]["secrets_key"] == KEY
    assert document["http"]["cors_origins"] == ["https://one.example", "https://two.example"]
    assert document["http"]["auth_cookie_secure"] is True
    assert document["limits"]["skill_max_files"] == 12
    assert document["integrations"]["mcp_stdio_allowed_commands"] == ["/usr/bin/a", "/路径/工具"]
    settings = Settings.validate_file_values(read_config(path))
    assert settings.fpl_secrets_key == KEY
    ciphertext = Fernet(KEY.encode()).encrypt(b"provider-secret-fixture")
    assert (
        Fernet(settings.fpl_secrets_key.encode()).decrypt(ciphertext) == b"provider-secret-fixture"
    )
    assert settings.database_path.name == "数据库.db"
    assert convert(path, apply=True)["status"] == "already_toml"


def test_existing_toml_never_falls_back_or_overwrites(tmp_path):
    path = legacy(tmp_path)
    publish(path, encode({"security": {"secrets_key": KEY}}))
    original = path.read_bytes()
    assert convert(path, apply=True)["status"] == "already_toml"
    assert path.read_bytes() == original
    assert path.with_name(".env").exists()
    path.write_text('[security]\nsecrets_key = "invalid-private-key"')
    with pytest.raises(ConfigurationError) as error:
        convert(path, apply=True)
    assert "invalid-private-key" not in str(error.value)


@pytest.mark.parametrize(
    "content",
    [
        '[security]\nsecrets_key = "secret-sentinel',
        '[secret-sentinel]\nunknown = "secret-sentinel"',
        '[http]\ncors_origins = "secret-sentinel"',
        '[http]\nauth_cookie_secure = "secret-sentinel"',
        "[limits]\nskill_max_files = true",
        '[security]\nunknown = "secret-sentinel"',
    ],
)
def test_malformed_config_errors_hide_values(tmp_path, content):
    path = tmp_path / "config.toml"
    path.write_text(content)
    with pytest.raises(ConfigurationError) as error:
        read_config(path)
    assert "secret-sentinel" not in str(error.value)


@pytest.mark.parametrize("extra", ["FPL_STUDIO_TOKEN=old-secret\n", "FPL_SKILL_MAX_FILES=-1\n"])
def test_invalid_legacy_is_preserved(tmp_path, extra):
    path = legacy(tmp_path, extra)
    before = path.with_name(".env").read_bytes()
    with pytest.raises(ConfigurationError):
        convert(path, apply=True)
    assert not path.exists()
    assert path.with_name(".env").read_bytes() == before


def test_precedence_and_desktop_isolation(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    publish(path, encode({"security": {"secrets_key": KEY}, "limits": {"skill_max_files": 4}}))
    monkeypatch.setenv("FPL_SKILL_MAX_FILES", "5")
    assert Settings(_config_file=path).fpl_skill_max_files == 5
    assert Settings(_config_file=path, fpl_skill_max_files=6).fpl_skill_max_files == 6
    assert Settings(_config_file=path, _read_environment=False).fpl_skill_max_files == 4
    desktop_path = legacy(tmp_path / "desktop/backend", "FPL_DATABASE_PATH=/wrong/path.db\n")
    monkeypatch.setenv("FPL_SECRETS_KEY", "invalid-shell-secret")
    desktop = prepare_configuration(tmp_path / "desktop")
    assert desktop.fpl_secrets_key == KEY
    assert desktop.fpl_skill_max_files == 500
    assert desktop.database_path == tmp_path / "desktop/runtime/future-props.db"
    assert desktop.cors_origins == ""
    assert desktop.auth_cookie_secure is False
    assert desktop_path.exists()


def test_missing_desktop_key_never_regenerates(tmp_path):
    root = tmp_path / "data"
    (root / "runtime").mkdir(parents=True)
    (root / "runtime/future-props.db").touch()
    with pytest.raises(ValueError, match="密钥缺失"):
        prepare_configuration(root)
    assert not (root / "backend/config.toml").exists()


def test_missing_legacy_key_and_invalid_toml_do_not_bootstrap(tmp_path):
    config = tmp_path / "backend/config.toml"
    config.parent.mkdir()
    config.with_name(".env").write_text("APP_PORT=9000\n")
    with pytest.raises(ConfigurationError, match="缺失"):
        prepare_configuration(tmp_path)
    assert not config.exists()
    config.write_text("[security]\nsecrets_key = 'invalid-secret'\n")
    with pytest.raises(ConfigurationError) as error:
        prepare_configuration(tmp_path)
    assert "invalid-secret" not in str(error.value)
    assert "invalid-secret" in config.read_text()


def test_all_supported_settings_have_a_toml_mapping():
    from fpl_config import FIELDS

    mapped = {field for section in FIELDS.values() for field, _kind in section.values()}
    assert mapped == set(Settings.model_fields) - {"legacy_fpl_studio_token"}


def test_publication_failure_keeps_legacy_and_backup(tmp_path, monkeypatch):
    import fpl_config.migration as migration

    path = legacy(tmp_path)
    original_publish = migration.publish

    def fail_config(target, content):
        if target == path:
            raise OSError("simulated disk full")
        original_publish(target, content)

    monkeypatch.setattr(migration, "publish", fail_config)
    with pytest.raises(OSError):
        convert(path, apply=True)
    assert path.with_name(".env").exists()
    assert len(list(tmp_path.glob(".env.backup-*"))) == 1
    assert not path.exists()


def test_concurrent_conversion_publishes_once(tmp_path):
    path = legacy(tmp_path)
    with ThreadPoolExecutor(2) as executor:
        results = list(executor.map(lambda _: convert(path, apply=True), range(2)))
    assert sorted(result["status"] for result in results) == ["already_toml", "converted"]
    assert len(list(tmp_path.glob(".env.backup-*"))) == 1


def test_migration_command_and_application_agree(tmp_path, monkeypatch):
    from db.migrations import runner

    path = legacy(tmp_path, "FPL_DATABASE_PATH='relative/db.sqlite'\n")
    convert(path, apply=True)
    monkeypatch.setattr(runner, "CONFIG_FILE", path)
    monkeypatch.delenv("FPL_DATABASE_PATH", raising=False)
    assert runner.resolve_database_path() == Settings(_config_file=path).database_path
    monkeypatch.setenv("FPL_DATABASE_PATH", str(tmp_path / "override.db"))
    assert runner.resolve_database_path() == Settings(_config_file=path).database_path
    assert runner.resolve_database_path(tmp_path / "explicit.db") == tmp_path / "explicit.db"


def test_encoding_preserves_quotes_backslashes_and_newlines(tmp_path):
    path = tmp_path / "config.toml"
    document = {"storage": {"database_path": '目录/"quote"\\slash\nline.db'}}
    publish(path, encode(document))
    assert tomllib.loads(path.read_text()) == document
    with pytest.raises(FileExistsError):
        publish(path, "overwrite")
    assert tomllib.loads(path.read_text()) == document
    assert not list(tmp_path.glob(".config-*.tmp"))
