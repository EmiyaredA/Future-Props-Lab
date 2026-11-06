"""Website integration components consume their own explicit configuration."""

import pytest
from cryptography.fernet import Fernet, InvalidToken

from studio.assembly.website.integrations import integration_bindings
from studio.config import settings as settings_module
from website_test_support import settings


def test_integration_instances_keep_separate_keys_clients_and_file_roots(tmp_path, monkeypatch):
    first = settings.model_copy(
        update={
            "fpl_secrets_key": Fernet.generate_key().decode(),
            "fpl_database_path": str(tmp_path / "first/data.db"),
        }
    )
    second = settings.model_copy(
        update={
            "fpl_secrets_key": Fernet.generate_key().decode(),
            "fpl_database_path": str(tmp_path / "second/data.db"),
        }
    )

    def no_global_configuration():
        pytest.fail("Integration assembly read global settings")

    monkeypatch.setattr(settings_module, "get_settings", no_global_configuration)
    bindings = [integration_bindings(value, None) for value in (first, second)]
    catalogs = [value.tool_apis(None, object(), "owner") for value in bindings]
    sealed = catalogs[0].cipher.encrypt("test-secret")
    assert catalogs[0].cipher.decrypt(sealed) == "test-secret"
    with pytest.raises(InvalidToken):
        catalogs[1].cipher.decrypt(sealed)
    for value, config in zip(bindings, (first, second), strict=True):
        assert value.mcp(None, object(), "owner").client.settings is config
        store = value.skills(None, object(), "owner").storage
        assert store.final_path("skill", "v1").is_relative_to(config.runtime_path)
        assert (
            value.external(None, object(), "owner").cipher.decrypt(
                value.tool_apis(None, object(), "owner").cipher.encrypt("same-instance")
            )
            == "same-instance"
        )
