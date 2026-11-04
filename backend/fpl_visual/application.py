"""Independent Visual application with owner-side certification."""

import json
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends

from app.apps.visual_workshop.acceptance.review_routes import router as review_router
from app.apps.visual_workshop.acceptance.standard_routes import router as standard_router
from app.apps.visual_workshop.generation_routes import router as generation_records_router
from app.apps.visual_workshop.models import VisualWorkshopProject
from app.deps import require_studio_auth
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime
from fpl_runtime.request_limit import RequestLimit
from fpl_runtime.video_segment_handoff import VISUAL_HANDOFFS, asset_peer, visual_peer
from fpl_runtime.web import attach_web, load_release

from .assistant_http import router as assistant_router
from .catalog_http import acceptance as acceptance_catalog_router
from .catalog_http import generation as generation_catalog_router
from .migrations.registry import MIGRATIONS
from .models import MODELS, VisualCanvasReferenceMutation, VisualCertificationReceipt
from .outputs_http import router as outputs_router
from .projects_http import router as project_router
from .repair_routes import router as repair_router
from .segment_handoff_routes import router as segment_handoff_router
from .segment_handoffs import SegmentHandoffs
from .segment_target_routes import router as segment_target_router

PAGES = (
    "/apps/visual-workshop",
    "/apps/visual-workshop/tasks",
    "/apps/visual-workshop/projects/{project_id}/canvas",
    "/apps/visual-workshop/projects/{project_id}/assets",
)


def create_app(
    *,
    state_root,
    public_key,
    credential,
    catalog,
    transport=None,
    run_worker=True,
    video_segment_key=None,
    segment_assets_key=None,
    web_root=None,
    schema_path=None,
):
    if bool(video_segment_key) != bool(segment_assets_key):
        raise ValueError("Visual 分段交接需要独立的 Video 和 Assets 对等凭据")
    if (
        video_segment_key is not None
        and len({video_segment_key, segment_assets_key, credential}) != 3
    ):
        raise ValueError("Visual 分段交接凭据必须独立")

    app = create_certification_app(
        service="visual",
        root=state_root,
        models=MODELS,
        migrations=MIGRATIONS,
        project=VisualWorkshopProject,
        receipts=VisualCertificationReceipt,
        key=public_key,
        credential=credential,
        catalog=catalog,
        transport=transport,
        run_worker=run_worker,
    )
    install_reference_runtime(
        app,
        service="visual",
        model=VisualCanvasReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )
    app.include_router(project_router)
    app.include_router(outputs_router)
    app.include_router(assistant_router)
    app.include_router(generation_catalog_router)
    app.include_router(acceptance_catalog_router)
    app.state.capabilities = CapabilityClient(
        service="visual", credential=credential, catalog=catalog, transport=transport
    )
    app.include_router(standard_router, prefix="/v1")
    app.include_router(review_router, prefix="/v1")
    app.include_router(repair_router)
    app.include_router(
        generation_records_router, prefix="/v1", dependencies=[Depends(require_studio_auth)]
    )
    app.include_router(segment_target_router)
    app.include_router(segment_handoff_router)
    app.add_middleware(RequestLimit, prefix=VISUAL_HANDOFFS, maximum=16 * 1024)
    app.state.segment_handoffs = None
    app.state.video_segment_peer = None
    if video_segment_key is not None:
        bind_segment_handoffs(app, credential, video_segment_key, segment_assets_key, transport)
    if web_root is not None:
        release = load_release(web_root, "visual")
        if schema_path is None or release.api_sha256 != public_contract(
            json.loads(schema_path.read_text()), "visual", catalog
        ):
            raise ValueError("视觉创作工坊浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_capability_client(instance):
        async with app.state.capabilities.client, lifespan(instance):
            yield

    app.router.lifespan_context = with_capability_client
    return app


def bind_segment_handoffs(app, credential, video_key, assets_key, transport):
    client = httpx.AsyncClient(transport=transport, trust_env=False, timeout=10)
    identity = LiveAuthorization(service="visual", credential=credential, transport=transport)
    app.state.video_segment_peer = visual_peer(video_key)
    app.state.segment_handoffs = SegmentHandoffs(
        app.state.database, client, asset_peer(assets_key), identity
    )
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_segment_handoffs(instance):
        try:
            async with lifespan(instance):
                yield
        finally:
            await identity.close()
            await client.aclose()

    app.router.lifespan_context = with_segment_handoffs
