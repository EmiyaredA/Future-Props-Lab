"""Independent Galgame application with owner-side certification."""

import json
from contextlib import asynccontextmanager

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime
from fpl_runtime.web import attach_web, load_release

from .asr_routes import router as asr_router
from .asset_read_routes import router as asset_read_router
from .migrations.registry import MIGRATIONS
from .models import MODELS, GalgameCertificationReceipt, GalgameStoryReferenceMutation
from .projects_http import router as project_router
from .story_migration_http import router as story_migration_router
from .task_http import router as task_router

PAGES = (
    "/apps/galgame-workshop",
    "/apps/galgame-workshop/projects/{project_id}/overview",
    "/apps/galgame-workshop/projects/{project_id}/editor",
    "/apps/galgame-workshop/projects/{project_id}/preview",
)


def create_app(
    *,
    state_root,
    public_key,
    credential,
    catalog,
    transport=None,
    run_worker=True,
    web_root=None,
    schema_path=None,
):
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
    app.include_router(asset_read_router)
    app.include_router(task_router)
    app.include_router(asr_router)
    app.include_router(story_migration_router)
    app.state.capabilities = CapabilityClient(
        service="galgame", credential=credential, catalog=catalog, transport=transport
    )
    if web_root is not None:
        release = load_release(web_root, "galgame")
        if schema_path is None or release.api_sha256 != public_contract(
            json.loads(schema_path.read_text()), "galgame", catalog
        ):
            raise ValueError("Galgame 浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_capability_client(instance):
        async with app.state.capabilities.client, lifespan(instance):
            yield

    app.router.lifespan_context = with_capability_client
    return app
