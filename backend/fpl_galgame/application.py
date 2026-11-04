"""Independent Galgame application with owner-side certification."""

from contextlib import asynccontextmanager

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.reference_runtime import install_reference_runtime

from .migrations.registry import MIGRATIONS
from .models import MODELS, GalgameCertificationReceipt, GalgameStoryReferenceMutation
from .projects_http import router as project_router
from .story_migration_http import router as story_migration_router


def create_app(*, state_root, public_key, credential, catalog, transport=None, run_worker=True):
    app = create_certification_app(
        service="galgame",
        root=state_root,
        models=MODELS,
        migrations=MIGRATIONS,
        project=GalgameWorkshopProject,
        receipts=GalgameCertificationReceipt,
        key=public_key,
        credential=credential,
        catalog=catalog,
        transport=transport,
        run_worker=run_worker,
    )
    install_reference_runtime(
        app,
        service="galgame",
        model=GalgameStoryReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )
    app.include_router(project_router)
    app.include_router(story_migration_router)
    app.state.capabilities = CapabilityClient(
        service="galgame", credential=credential, catalog=catalog, transport=transport
    )
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_capability_client(instance):
        async with app.state.capabilities.client, lifespan(instance):
            yield

    app.router.lifespan_context = with_capability_client
    return app
