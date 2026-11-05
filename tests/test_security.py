import pytest
from pydantic import ValidationError

from app.capabilities.identity.passwords import hash_password, validate_password, verify_password
from app.capabilities.identity.security import new_management_api_key
from app.llm.schemas.model_service import ProviderIn
from studio.config.settings import Settings
from studio.runtime.http.outbound_urls import (
    normalize_provider_base_url,
    normalize_provider_websocket_url,
)


def test_secret_round_trip_does_not_store_plaintext() -> None:
    hashed = hash_password("Strong-Password-2026!")
    assert "Strong-Password-2026!" not in hashed
    assert hashed.startswith("$argon2id$")
    assert verify_password(hashed, "Strong-Password-2026!")[0]
    assert not verify_password(hashed, "wrong-password")[0]


def test_password_policy_and_management_key_prefix() -> None:
    validate_password("Strong-Password-2026!")
    with pytest.raises(ValueError):
        validate_password("too-short")
    assert new_management_api_key().startswith("fpm_")


def test_legacy_studio_token_is_rejected() -> None:
    with pytest.raises(ValidationError, match="FPL_STUDIO_TOKEN is no longer supported"):
        Settings(
            FPL_SECRETS_KEY="Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=",
            FPL_STUDIO_TOKEN="legacy-token",
        )


def test_provider_urls_require_https_except_for_loopback() -> None:
    common = {
        "expected_catalog_revision": 0,
        "name": "provider",
        "kind": "openai",
    }
    with pytest.raises(ValidationError, match="HTTPS"):
        ProviderIn(**common, base_url="http://provider.example/v1")
    assert ProviderIn(**common, base_url="http://127.0.0.1:8080/v1").base_url == (
        "http://127.0.0.1:8080/v1"
    )
    assert normalize_provider_base_url("http://[::1]:8080/v1") == "http://[::1]:8080/v1"


def test_realtime_provider_requires_secure_websocket_except_for_loopback() -> None:
    common = {
        "expected_catalog_revision": 0,
        "name": "realtime",
        "kind": "senseaudio_realtime",
    }
    with pytest.raises(ValidationError, match="WSS"):
        ProviderIn(**common, base_url="ws://voice.example/realtime")
    with pytest.raises(ValidationError, match="WSS"):
        ProviderIn(**common, base_url="https://voice.example/realtime")
    assert (
        ProviderIn(**common, base_url="wss://voice.example/realtime").base_url
        == "wss://voice.example/realtime"
    )
    assert normalize_provider_websocket_url("ws://127.0.0.1:8080/realtime") == (
        "ws://127.0.0.1:8080/realtime"
    )


def test_temporary_media_upload_is_opt_in() -> None:
    settings = Settings(
        FPL_SECRETS_KEY="Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=",
        FPL_TEMP_MEDIA_UPLOAD_URL="",
    )
    assert settings.fpl_temp_media_upload_url == ""
