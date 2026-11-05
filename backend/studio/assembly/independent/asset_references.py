"""Attach each project's own ledger and managed Assets client to its HTTP app."""

from contextlib import asynccontextmanager

from studio.apps.asset_library.clients.reference_mutations import (
    ReferenceDelivery,
    ReferenceMutations,
)
from studio.apps.asset_library.clients.retention import RetentionClient
from studio.runtime.project_errors import ProjectResourceError


def install_reference_runtime(
    app, *, service, model, public_key, credential, transport, run_worker
):
    sessions = app.state.database.sessions
    client = RetentionClient(service=service, credential=credential, transport=transport)
    app.state.retention_client = client
    app.state.run_reference_worker = run_worker
    app.state.reference_mutations = ReferenceMutations(
        sessions,
        client,
        service=service,
        model=model,
        public_key=public_key,
        failure=lambda message, status, code: ProjectResourceError(message, code, status),
    )
    app.state.reference_delivery = ReferenceDelivery(sessions, client, service=service, model=model)


@asynccontextmanager
async def reference_lifespan(app):
    delivery = app.state.reference_delivery
    try:
        if app.state.run_reference_worker:
            await delivery.start()
        yield
    finally:
        await delivery.stop()
        await app.state.retention_client.close()
