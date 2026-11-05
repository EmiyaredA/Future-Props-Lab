"""Narrow account-scoped authentication on the service mesh."""

import re

from studio.contracts.asset_library.descriptions import ID

DIGEST = r"[0-9a-f]{64}"


class TimedPeer:
    """Sign one internal method, path and account for a short replay window."""

    OWNER = "X-Fpl-Peer-Owner"
    TIME = "X-Fpl-Peer-Time"
    PROOF = "X-Fpl-Peer-Proof"

    def __init__(self, secret, *, domain):
        if not isinstance(secret, str) or not secret.isascii() or len(secret) < 32:
            raise ValueError("服务对等凭据无效")
        self.key = secret.encode("ascii")
        self.domain = domain

    def _digest(self, method, path, owner, timestamp):
        import hmac
        import json

        message = json.dumps([method, path, owner, timestamp], separators=(",", ":")).encode()
        return hmac.digest(self.key, self.domain + b"\0" + message, "sha256").hex()

    def headers(self, method, path, owner, *, now=None):
        import time

        timestamp = str(int(time.time()) if now is None else now)
        return {
            self.OWNER: owner,
            self.TIME: timestamp,
            self.PROOF: self._digest(method, path, owner, timestamp),
        }

    def owner(self, method, path, headers, *, now=None):
        import hmac
        import time

        owner = headers.get(self.OWNER, "")
        timestamp = headers.get(self.TIME, "")
        proof = headers.get(self.PROOF, "")
        current = int(time.time()) if now is None else now
        if (
            re.fullmatch(ID, owner)
            and re.fullmatch(r"[0-9]{1,12}", timestamp)
            and abs(current - int(timestamp)) <= 30
            and re.fullmatch(DIGEST, proof)
            and hmac.compare_digest(proof, self._digest(method, path, owner, timestamp))
        ):
            return owner
        raise ValueError("服务对等签名无效")


def load_peer_key(path, *, excluded=()):
    if path.is_symlink():
        raise ValueError("服务对等凭据必须为受保护的普通文件")
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("服务对等凭据必须为受保护的普通文件")
    secret = path.read_text().strip()
    if secret in excluded:
        raise ValueError("服务对等凭据必须独立")
    return secret
