"""Validation requests retain their capacity until confirmed outbound completion."""

from contextlib import suppress

from fastapi import Request

from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.apps.integrations.validation import prepare
from studio.assembly.http_dependencies import SessionDep, StudioAuth


async def validation_capacity(request: Request, session: SessionDep, principal: StudioAuth):
    run = await prepare(request, session, principal)
    try:
        yield
    finally:
        if run is not None:
            await session.rollback()
            # Release is durable outbox work; a settlement outage cannot turn a
            # completed external call into an apparent retryable request failure.
            with suppress(IntegrationAuthorizationUnavailable):
                await run.settle()
