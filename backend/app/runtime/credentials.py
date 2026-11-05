from cryptography.fernet import Fernet

from studio.config.settings import get_settings


def _fernet() -> Fernet:
    return Fernet(get_settings().fpl_secrets_key.encode("ascii"))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    return _fernet().decrypt(value.encode("ascii")).decode("utf-8")


class SecretCipher:
    """An explicitly configured application's credential encryption boundary."""

    def __init__(self, key: str):
        self._cipher = Fernet(key.encode("ascii"))

    def encrypt(self, value: str) -> str:
        return self._cipher.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, value: str) -> str:
        return self._cipher.decrypt(value.encode("ascii")).decode("utf-8")

    def hint(self, value: str) -> str:
        if not value:
            return ""
        try:
            plain = self.decrypt(value)
        except Exception:
            return ""
        return plain[-4:] if len(plain) >= 4 else "••••"
