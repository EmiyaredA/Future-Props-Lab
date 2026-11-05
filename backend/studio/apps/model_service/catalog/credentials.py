"""Credential operations required by model catalogue and diagnostic use cases."""

from typing import Protocol


class CatalogCipher(Protocol):
    """The assembly owns key selection; callers never receive or discover the key.

    Ciphertext remains compatible with stored provider credentials. Hints disclose at
    most the existing suffix; unreadable ciphertext yields no hint, not plaintext.
    Decryption failures propagate for execution rather than trying another key.
    """

    def encrypt(self, value: str) -> str: ...

    def decrypt(self, value: str) -> str: ...

    def hint(self, value: str) -> str: ...
