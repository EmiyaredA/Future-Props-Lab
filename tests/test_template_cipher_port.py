"""Template secrets use the injected cipher, including preserved-key previews."""

import pytest
from cryptography.fernet import Fernet
from tests.test_owned_model_role_policy import policy

from studio.apps.model_service.catalog.template_values import prepare_template, template_view
from studio.runtime.secrets import SecretCipher


class MemoryCipher:
    def __init__(self):
        self.values = {}

    def encrypt(self, value):
        key = f"opaque-{len(self.values)}"
        self.values[key] = value
        return key

    def hint(self, value):
        secret = self.values.get(value, "")
        return secret[-4:] if len(secret) >= 4 else "••••" if secret else ""


@pytest.mark.parametrize("kind", ["memory", "fernet"])
def test_template_cipher_contract(kind, monkeypatch):
    from studio.config import settings

    def forbidden():
        raise AssertionError("Template read attempted to load global deployment settings")

    monkeypatch.setattr(settings, "get_settings", forbidden)
    cipher = MemoryCipher() if kind == "memory" else SecretCipher(Fernet.generate_key().decode())
    body = policy(key="synthetic-private-secret").value
    payload = prepare_template(body, {}, cipher=cipher)
    encrypted = payload["providers"][0]["api_key_ciphertext"]
    assert encrypted and encrypted != body.providers[0].api_key
    view = template_view(payload, cipher=cipher)
    provider = view["providers"][0]
    assert provider["has_api_key"] and provider["api_key_hint"] == "cret"
    assert "api_key_ciphertext" not in provider and "api_key" not in provider
    assert payload["providers"][0]["api_key_ciphertext"] == encrypted
    retained = prepare_template(policy(key="").value, payload, cipher=cipher)
    assert retained["providers"][0]["api_key_ciphertext"] == encrypted
    cleared = prepare_template(policy(key="", clear=True).value, payload, cipher=cipher)
    assert cleared["providers"][0]["api_key_ciphertext"] == ""


def test_fernet_templates_do_not_share_deployment_keys():
    first, second = (SecretCipher(Fernet.generate_key().decode()) for _ in range(2))
    payload = prepare_template(policy(key="first-secret").value, {}, cipher=first)
    assert template_view(payload, cipher=first)["providers"][0]["api_key_hint"] == "cret"
    assert template_view(payload, cipher=second)["providers"][0]["api_key_hint"] == ""
