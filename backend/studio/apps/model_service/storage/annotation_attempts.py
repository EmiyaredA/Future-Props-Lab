"""Short-transaction attempt reservation and same-transaction outcome updates."""

from copy import deepcopy
from dataclasses import dataclass

from sqlalchemy import text

from studio.apps.model_service.storage.service_models import AnnotationTranscriptionAttempt


@dataclass(frozen=True)
class AttemptSnapshot:
    fingerprint: str
    result: dict | None
    error: dict | None


class AnnotationAttempts:
    def __init__(self, session, key):
        self.session, self.key = session, key

    async def reserve(self, fingerprint):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        previous = await self.read()
        if previous is not None:
            return previous
        self.session.add(
            AnnotationTranscriptionAttempt(
                owner_user_id=self.key[0], attempt_id=self.key[1], fingerprint=fingerprint
            )
        )
        await self.session.commit()
        return None

    async def read(self):
        row = await self.session.get(AnnotationTranscriptionAttempt, self.key)
        if row is None:
            return None
        return AttemptSnapshot(row.fingerprint, deepcopy(row.result), deepcopy(row.error))

    async def settle(self, *, result=None, error=None):
        row = await self.session.get(AnnotationTranscriptionAttempt, self.key)
        if result is not None:
            row.result = result.model_dump(mode="json")
        else:
            row.error = error

    async def commit(self):
        await self.session.commit()
