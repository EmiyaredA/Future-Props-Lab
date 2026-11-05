"""Owned quota values. The HTTP adapter owns administrator checks and audit delivery."""

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert

from app.llm.schemas.runtime_quotas import RuntimeQuotas
from studio.apps.model_service.storage.service_models import QuotaPolicy
from studio.contracts.identity.errors import AccountError
from studio.runtime.time import utc_now


class QuotaPolicies:
    def __init__(self, session):
        self.session = session

    async def read(self):
        row = await self.session.scalar(
            select(QuotaPolicy)
            .where(QuotaPolicy.id == "runtime")
            .execution_options(populate_existing=True)
        )
        return {
            "revision": row.revision if row else 0,
            "value": RuntimeQuotas.model_validate(row.payload) if row else RuntimeQuotas(),
        }

    async def save(self, body):
        current = await self.read()
        if current["revision"] != body.expected_revision:
            raise self.conflict(current)
        values = {"payload": body.value.model_dump(), "updated_at": utc_now()}
        if body.expected_revision == 0:
            statement = insert(QuotaPolicy).values(id="runtime", revision=1, **values)
            statement = statement.on_conflict_do_nothing(index_elements=[QuotaPolicy.id])
        else:
            statement = (
                update(QuotaPolicy)
                .where(QuotaPolicy.id == "runtime", QuotaPolicy.revision == body.expected_revision)
                .values(revision=body.expected_revision + 1, **values)
            )
        if (await self.session.execute(statement)).rowcount != 1:
            raise self.conflict(await self.read())
        return await self.read()

    @staticmethod
    def conflict(current):
        return AccountError(
            "revision_conflict",
            current={"revision": current["revision"], "value": current["value"].model_dump()},
        )
