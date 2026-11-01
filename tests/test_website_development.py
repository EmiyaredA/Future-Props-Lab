import tomllib

from scripts.website.development import environment


def test_development_does_not_inherit_formal_data_credentials_or_configuration(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("FPL_CONFIG_FILE", "/formal/backend/config.toml")
    monkeypatch.setenv("FPL_DATABASE_PATH", "/formal/future-props.db")
    monkeypatch.setenv("FPL_SECRETS_KEY", "formal-secret")
    monkeypatch.setenv("FPL_REMOTE_WEB_ENABLED", "true")
    values = environment(tmp_path)
    assert set(name for name in values if name.startswith("FPL_")) == {
        "FPL_CONFIG_FILE",
        "FPL_DATABASE_PATH",
    }
    config = tmp_path / ".local/dev-runtime/backend/config.toml"
    first = config.read_bytes()
    assert config.stat().st_mode & 0o777 == 0o600
    document = tomllib.loads(first.decode())
    assert document["security"]["secrets_key"] != "formal-secret"
    assert document["storage"]["database_path"] == values["FPL_DATABASE_PATH"]
    assert environment(tmp_path)["FPL_CONFIG_FILE"] == str(config)
    assert config.read_bytes() == first
