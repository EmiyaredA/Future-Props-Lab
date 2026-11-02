"""Asset configuration has file limits and owned paths, without unrelated credentials."""

import pytest

from fpl_assets.settings import load_settings
from fpl_config import ConfigurationError


def test_minimal_assets_configuration_needs_no_secret(tmp_path):
    config = tmp_path / "assets.toml"
    target = tmp_path / "data/service.db"
    config.write_text(
        '[storage]\ndatabase_path = "' + str(target) + '"\n'
        "[limits]\nvisual_asset_max_bytes = 1024\nproject_snapshot_max_files = 25\n"
    )
    (tmp_path / ".env").write_text("FPL_DATABASE_PATH=/should-not-be-read/service.db\n")
    settings = load_settings(config, environ={})
    assert settings.database_path == target
    assert settings.fpl_visual_asset_max_bytes == 1024
    assert settings.fpl_project_snapshot_max_files == 25
    assert settings.account_path("alpha") == tmp_path / "data/accounts/alpha"
    assert not hasattr(settings, "fpl_secrets_key")
    overridden = load_settings(config, environ={"FPL_VISUAL_ASSET_MAX_BYTES": "2048"})
    assert overridden.fpl_visual_asset_max_bytes == 2048
    assert settings.fpl_visual_asset_max_bytes == 1024


@pytest.mark.parametrize(
    "extra",
    [
        '[security]\nsecrets_key = "synthetic-private-value"\n',
        '[code_agents]\ncodex_executable = "synthetic-private-value"\n',
    ],
)
def test_assets_rejects_foreign_configuration_without_echoing_values(tmp_path, extra):
    config = tmp_path / "assets.toml"
    config.write_text('[storage]\ndatabase_path = "/state/service.db"\n' + extra)
    with pytest.raises(ConfigurationError) as rejected:
        load_settings(config, environ={})
    assert "synthetic-private-value" not in str(rejected.value)


@pytest.mark.parametrize("value", ["0", "-1", "nonsense", "1.2"])
def test_invalid_limits_are_rejected(tmp_path, value):
    config = tmp_path / "assets.toml"
    config.write_text('[storage]\ndatabase_path = "/state/service.db"\n')
    with pytest.raises(ConfigurationError):
        load_settings(config, environ={"FPL_PROJECT_SNAPSHOT_MAX_FILES": value})


def test_missing_database_and_escaped_account_paths_are_rejected(tmp_path):
    config = tmp_path / "assets.toml"
    config.write_text("")
    with pytest.raises(ConfigurationError):
        load_settings(config, environ={})
    config.write_text('[storage]\ndatabase_path = "' + str(tmp_path / "service.db") + '"\n')
    settings = load_settings(config, environ={})
    for owner in ("", "..", "../private"):
        with pytest.raises(ValueError):
            settings.account_path(owner)
    (tmp_path / "accounts").mkdir()
    external = tmp_path / "external"
    external.mkdir()
    (tmp_path / "accounts/alpha").symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError):
        settings.account_path("alpha")
