from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.deps as deps
from app.core.credentials import decrypt_secret, encrypt_secret


def test_secret_round_trip_does_not_store_plaintext() -> None:
    ciphertext = encrypt_secret("sk-example-secret")
    assert "sk-example-secret" not in ciphertext
    assert decrypt_secret(ciphertext) == "sk-example-secret"


def test_optional_studio_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(fpl_studio_token=""))
    deps.verify_studio_token(None)

    configured = "a" * 32
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(fpl_studio_token=configured))
    deps.verify_studio_token(configured)
    with pytest.raises(HTTPException) as caught:
        deps.verify_studio_token("wrong")
    assert caught.value.status_code == 401
    assert caught.value.detail["code"] == "studio_auth_required"
