"""Short-lived browser grants for the FPL Happier ingress."""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

import jwt
from cryptography.fernet import Fernet, InvalidToken

from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal

TICKET_SECONDS = 60


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class OneTimeGrants:
    def __init__(self, clock):
        self.clock = clock
        self.entries = {}

    def issue(self, value):
        now = self.clock()
        self.entries = {key: entry for key, entry in self.entries.items() if entry[0] > now}
        if len(self.entries) >= 256:
            return None
        secret = secrets.token_urlsafe(32)
        self.entries[fingerprint(secret)] = (now + TICKET_SECONDS, value)
        return secret

    def redeem(self, secret):
        entry = self.entries.pop(fingerprint(secret), None)
        return entry[1] if entry and entry[0] > self.clock() else None


@dataclass(frozen=True)
class BrowserGrant:
    principal: StudioPrincipal
    local: bool
    expires: int
    proof: str | None = None


class HappierAccess:
    def __init__(self, *, origin, authorize_grant, clock=time.time):
        self.origin = origin
        self.authorize_grant = authorize_grant
        self.clock = clock
        self.launches = OneTimeGrants(clock)
        self.cookie_key = secrets.token_bytes(32)
        self.proof_cipher = Fernet(Fernet.generate_key())

    def launch(self, principal, local, expires, *, proof=None):
        return self.launches.issue(BrowserGrant(principal, local, int(expires), proof))

    async def allowed(self, grant):
        return grant.expires > self.clock() and await self.authorize_grant(grant)

    def cookie(self, grant):
        claims = {
            "sub": grant.principal.user_id,
            "sid": grant.principal.session_id,
            "local": grant.local,
            "exp": grant.expires,
        }
        if grant.proof:
            claims["proof"] = self.proof_cipher.encrypt(grant.proof.encode()).decode()
        return jwt.encode(claims, self.cookie_key, algorithm="HS256")

    def browser_grant(self, cookie):
        if not cookie:
            return None
        try:
            data = jwt.decode(cookie, self.cookie_key, algorithms=["HS256"])
            proof = (
                self.proof_cipher.decrypt(data["proof"].encode()).decode()
                if "proof" in data
                else None
            )
        except (jwt.InvalidTokenError, InvalidToken):
            return None
        return BrowserGrant(
            StudioPrincipal(
                user_id=data["sub"],
                session_id=data["sid"],
                auth_kind="session",
                scopes=role_scopes("admin"),
                platform_role="admin",
                must_change_password=False,
            ),
            data["local"],
            data["exp"],
            proof,
        )
