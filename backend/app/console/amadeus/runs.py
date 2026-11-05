"""Bind Amadeus run records to the compatibility site's connection registry."""

from app.console.amadeus.run_records import RunRecords
from app.console.amadeus.run_recovery import recover_runs
from app.console.governance.code_agents import resolve
from app.runtime.db import SessionLocal


class Runs(RunRecords):
    def __init__(self, session, principal):
        async def connection(agent_id):
            return await resolve(
                session, principal.owner_user_id, principal.user_id, agent_id, "amadeus"
            )

        super().__init__(session, principal, resolve_agent=connection)


async def recover_interrupted_amadeus_runs() -> None:
    """Settle process-owned work before accepting new runs after startup."""
    async with SessionLocal() as session:
        await recover_runs(session)
