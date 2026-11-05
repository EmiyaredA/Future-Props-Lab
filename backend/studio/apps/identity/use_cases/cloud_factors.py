"""Factor rules over an atomic account store, an explicit cipher and clocks.

An invalid code consumes an attempt in the same transaction. Successful replay
protection, factor rotation and unlock creation also commit together. A lost
acknowledgement must not trigger automatic verification or enrollment retries.
"""

import base64
import hmac
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Protocol

from studio.contracts.identity.principal import StudioPrincipal

UNLOCK_SECONDS = 900


class FactorError(Exception):
    def __init__(self, status: int, detail: str | dict):
        super().__init__(str(detail))
        self.status = status
        self.detail = detail


@dataclass(frozen=True, repr=False)
class FactorSnapshot:
    secret: str | None = None
    pending_secret: str | None = None
    pending_until: int = 0
    last_counter: int = -1
    attempts: int = 0
    attempt_window: int = 0


@dataclass(frozen=True)
class FactorDecision:
    factor: FactorSnapshot | None = None
    revoke_unlocks: bool = False
    unlock_until: int | None = None
    desktop: bool = False
    error: FactorError | None = None


class FactorStore(Protocol):
    async def update(
        self,
        principal: StudioPrincipal,
        decide: Callable[[FactorSnapshot | None], FactorDecision],
        *,
        public: bool,
    ) -> FactorDecision:
        """Recheck the active admin session under a writer lock, then decide/commit.

        `public` also requires password reauthentication after session creation.
        The callback runs once against a detached snapshot while holding the
        lock. Cancellation and exceptions roll back all writes. The returned
        decision follows durable commit, including rejected-code attempt counts.
        """
        ...


class FactorCipher(Protocol):
    def encrypt(self, value: str) -> str: ...

    def decrypt(self, value: str) -> str: ...


def totp(secret: str, counter: int) -> str:
    digest = hmac.digest(base64.b32decode(secret), counter.to_bytes(8, "big"), "sha1")
    offset = digest[-1] & 15
    value = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{value % 1000000:06}"


class CloudFactors:
    def __init__(self, store: FactorStore, *, cipher: FactorCipher, clock, secret_bytes):
        self.store = store
        self.cipher = cipher
        self.clock = clock
        self.secret_bytes = secret_bytes

    async def enroll(self, principal: StudioPrincipal) -> str:
        secret = base64.b32encode(self.secret_bytes(20)).decode("ascii")
        encrypted = self.cipher.encrypt(secret)

        def decide(current):
            return FactorDecision(
                factor=replace(
                    current or FactorSnapshot(),
                    pending_secret=encrypted,
                    pending_until=int(self.clock()) + 300,
                )
            )

        await self.store.update(principal, decide, public=False)
        return secret

    async def verify(self, principal, code, *, enroll=False, desktop=False, public=False):
        def decide(current):
            return self._verification(current, code, enroll=enroll, desktop=desktop)

        decision = await self.store.update(principal, decide, public=public)
        if decision.error is not None:
            raise decision.error

    def _verification(self, current, code, *, enroll, desktop):
        now = int(self.clock())
        if not current or not (current.pending_secret if enroll else current.secret):
            return FactorDecision(error=FactorError(409, "请先在本机登记验证器"))
        if enroll and current.pending_until <= now:
            return FactorDecision(error=FactorError(409, "登记已过期，请重新开始"))
        if current.attempt_window + 300 <= now:
            current = replace(current, attempt_window=now, attempts=0)
        if current.attempts >= 5:
            return FactorDecision(error=FactorError(429, "验证码尝试过多，请稍后再试"))
        secret = self.cipher.decrypt(current.pending_secret if enroll else current.secret)
        counter = now // 30
        match = next(
            (
                step
                for step in (counter + 1, counter, counter - 1)
                if (enroll or step > current.last_counter)
                and hmac.compare_digest(totp(secret, step), code)
            ),
            None,
        )
        if match is None:
            return FactorDecision(
                factor=replace(current, attempts=current.attempts + 1),
                error=FactorError(403, "验证码无效或已使用"),
            )
        current = replace(current, last_counter=match, attempts=0)
        if enroll:
            current = replace(
                current, secret=current.pending_secret, pending_secret=None, pending_until=0
            )
        return FactorDecision(
            factor=current,
            revoke_unlocks=enroll,
            unlock_until=None if desktop else now + UNLOCK_SECONDS,
            desktop=desktop,
        )
