"""Encrypt synthetic fixture values using conftest's isolated application key."""

from studio.config.settings import get_settings
from studio.runtime.secrets import SecretCipher


def encrypt_secret(value: str) -> str:
    return SecretCipher(get_settings().fpl_secrets_key).encrypt(value)


def decrypt_secret(value: str) -> str:
    return SecretCipher(get_settings().fpl_secrets_key).decrypt(value)
