"""Recover compatibility website run records after a restart."""

from studio.apps.amadeus.storage.recovery import recover_runs


async def recover_interrupted_amadeus_runs(*, sessions) -> None:
    """Settle process-owned work before accepting new runs after startup."""
    async with sessions() as session:
        await recover_runs(session)
