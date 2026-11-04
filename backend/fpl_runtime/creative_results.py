"""Authenticate target results and fresh receipt-absence responses per request."""

import hashlib
import hmac
import json
import re


class CreativeResultAuthenticator:
    def __init__(self, secret: str):
        if not isinstance(secret, str) or not secret.isascii() or len(secret) < 32:
            raise ValueError("Creative result credential is invalid")
        self._secret = secret.encode("ascii")

    def stdio_digest(self, installation_id, configuration):
        from .integration_intents import digest

        checksum = digest([installation_id, configuration.model_dump(mode="json")])
        return hmac.new(
            self._secret, b"creative-stdio-v1:" + checksum.encode(), hashlib.sha256
        ).hexdigest()

    def sign(self, *, action, operation, fingerprint, nonce, status, body):
        if (
            action not in {"install", "receipt", "cancel", "setup"}
            or not isinstance(operation, str)
            or not operation
            or not isinstance(fingerprint, str)
            or not re.fullmatch(r"[a-f0-9]{64}", fingerprint)
            or not isinstance(nonce, str)
            or not re.fullmatch(r"[a-f0-9]{32}", nonce)
            or type(status) is not int
            or status not in {200, 404}
            or not isinstance(body, bytes)
        ):
            raise ValueError("Creative result binding is invalid")
        message = json.dumps(
            {
                "version": 1,
                "action": action,
                "operation": operation,
                "fingerprint": fingerprint,
                "nonce": nonce,
                "status": status,
                "body_sha256": hashlib.sha256(body).hexdigest(),
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("ascii")
        return hmac.new(self._secret, message, hashlib.sha256).hexdigest()

    def verify(self, signature, **binding):
        if not isinstance(signature, str) or not re.fullmatch(r"[a-f0-9]{64}", signature):
            raise ValueError("Creative result signature is invalid")
        if not hmac.compare_digest(signature, self.sign(**binding)):
            raise ValueError("Creative result signature does not match")
