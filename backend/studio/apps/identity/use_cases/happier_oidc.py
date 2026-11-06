"""Single-client authorization codes and browser grants for a dedicated Happier deployment."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal

CLIENT_ID = "fpl-happier"
OIDC_PATH = "/v1/cloud-control/happier/oidc"
EXCHANGE_PATH = "/v1/cloud-control/happier/exchange"
BROWSER_COOKIE = "__Host-fpl_happier"
CODE_SECONDS = 60
TOKEN_RE = re.compile(r"[A-Za-z0-9._~-]{43,128}")


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
        self.entries[fingerprint(secret)] = (now + CODE_SECONDS, value)
        return secret

    def redeem(self, secret):
        entry = self.entries.pop(fingerprint(secret), None)
        return entry[1] if entry and entry[0] > self.clock() else None


@dataclass(frozen=True)
class BrowserGrant:
    principal: StudioPrincipal
    local: bool
    expires: int


@dataclass(frozen=True)
class Authorization:
    grant: BrowserGrant
    challenge: str
    nonce: str | None


class HappierIdentity:
    def __init__(self, *, origin, client_secret, authorize_grant, clock=time.time):
        self.origin = origin
        self.issuer = origin + OIDC_PATH
        self.callback = origin + "/v1/oauth/fpl/callback"
        self.authorize_grant = authorize_grant
        self.clock = clock
        self.client_secret = client_secret
        self.launches = OneTimeGrants(clock)
        self.codes = OneTimeGrants(clock)
        self.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = secrets.token_hex(12)
        self.cookie_key = secrets.token_bytes(32)

    def launch(self, principal, local, expires):
        return self.launches.issue(BrowserGrant(principal, local, int(expires)))

    async def allowed(self, grant):
        return grant.expires > self.clock() and await self.authorize_grant(grant)

    def cookie(self, grant):
        return jwt.encode(
            {
                "sub": grant.principal.user_id,
                "sid": grant.principal.session_id,
                "local": grant.local,
                "exp": grant.expires,
            },
            self.cookie_key,
            algorithm="HS256",
        )

    def browser_grant(self, cookie):
        if not cookie:
            return None
        try:
            data = jwt.decode(cookie, self.cookie_key, algorithms=["HS256"])
        except jwt.InvalidTokenError:
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
        )

    def discovery(self):
        return {
            "issuer": self.issuer,
            "authorization_endpoint": self.issuer + "/authorize",
            "token_endpoint": self.issuer + "/token",
            "jwks_uri": self.issuer + "/jwks",
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": ["openid", "profile"],
        }

    def jwks(self):
        key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.signer.public_key()))
        return {"keys": [{**key, "kid": self.kid, "alg": "RS256", "use": "sig"}]}

    def authorize(self, grant, params):
        state = params.get("state", "")
        nonce = params.get("nonce")
        challenge = params.get("code_challenge", "")
        if (
            params.get("client_id") != CLIENT_ID
            or params.get("response_type") != "code"
            or params.get("redirect_uri") != self.callback
            or "openid" not in params.get("scope", "").split()
            or params.get("code_challenge_method") != "S256"
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge)
            or not 1 <= len(state) <= 4096
            or (nonce is not None and not 1 <= len(nonce) <= 512)
        ):
            return None
        code = self.codes.issue(Authorization(grant, challenge, nonce))
        return self.callback + "?" + urlencode({"code": code, "state": state}) if code else None

    def client_authenticated(self, client_id, secret):
        return client_id == CLIENT_ID and secrets.compare_digest(
            fingerprint(secret), fingerprint(self.client_secret)
        )

    async def token(self, params):
        verifier = params.get("code_verifier", "")
        if (
            params.get("grant_type") != "authorization_code"
            or params.get("redirect_uri") != self.callback
            or not TOKEN_RE.fullmatch(verifier)
        ):
            return None
        authorization = self.codes.redeem(params.get("code", ""))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        if (
            authorization is None
            or not secrets.compare_digest(challenge.rstrip(b"=").decode(), authorization.challenge)
            or not await self.allowed(authorization.grant)
        ):
            return None
        now = int(self.clock())
        lifetime = min(60, authorization.grant.expires - now)
        claims = {
            "iss": self.issuer,
            "aud": CLIENT_ID,
            "sub": authorization.grant.principal.user_id,
            "iat": now,
            "exp": now + lifetime,
            "preferred_username": "fpl_admin",
        }
        if authorization.nonce is not None:
            claims["nonce"] = authorization.nonce
        return {
            "token_type": "Bearer",
            "access_token": secrets.token_urlsafe(32),
            "expires_in": lifetime,
            "id_token": jwt.encode(
                claims, self.signer, algorithm="RS256", headers={"kid": self.kid}
            ),
        }
