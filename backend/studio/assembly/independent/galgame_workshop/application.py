"""Independent Galgame application with owner-side certification."""

import json
from contextlib import asynccontextmanager

from fastapi import HTTPException
from sqlalchemy import text

from app.capabilities.asset_store.project_snapshots import cleanup_snapshot_staging
from studio.apps.asset_library.clients.archive_transfer import (
    ArchiveTransport,
    SnapshotArchiveAsset,
)
from studio.apps.galgame_workshop.annotation.annotation_runner import AnnotationImports
from studio.apps.galgame_workshop.exports.export_runner import ExportRunner
from studio.apps.galgame_workshop.handoffs.handoff_runner import HandoffRunner
from studio.apps.galgame_workshop.snapshots.snapshot_exports import SnapshotSettings
from studio.apps.galgame_workshop.snapshots.snapshot_imports import (
    SnapshotDelivery,
    SnapshotImports,
)
from studio.apps.galgame_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.galgame_workshop.storage.models import GalgameWorkshopProject
from studio.apps.galgame_workshop.storage.service_models import (
    MODELS,
    GalgameCertificationReceipt,
    GalgameStoryReferenceMutation,
)
from studio.apps.galgame_workshop.transcription.asr_runner import AsrRunner
from studio.apps.galgame_workshop.transport.asr_routes import router as asr_router
from studio.apps.galgame_workshop.transport.asset_read_routes import router as asset_read_router
from studio.apps.galgame_workshop.transport.projects_http import router as project_router
from studio.apps.galgame_workshop.transport.snapshot_http import router as snapshot_router
from studio.apps.galgame_workshop.transport.story_migration_http import (
    router as story_migration_router,
)
from studio.apps.galgame_workshop.transport.task_http import router as task_router
from studio.apps.galgame_workshop.transport.upload_http import router as upload_router
from studio.apps.galgame_workshop.upload_intakes import UploadIntakes
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.assembly.independent.asset_references import install_reference_runtime
from studio.assembly.independent.certified_project import create_certification_app
from studio.contracts.galgame_workshop.galgame_snapshot import (
    ARCHIVE_DOMAIN,
    ARCHIVE_PREFIX,
    ARCHIVE_PURPOSE,
    IMPORT,
)
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.web import attach_web, load_release

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
    archive_key=None,
    web_root=None,
    schema_path=None,
):
    async def ready(instance):
        if archive_key is None or web_root is None:
            raise HTTPException(503, "galgame_production_dependencies_missing")
        state = instance.state
        if run_worker and not all(
            runner.is_healthy
            for runner in (
                state.project_certifications,
                state.reference_delivery,
                state.upload_intakes,
                state.annotation_imports,
                state.asr_runner,
                state.export_runner,
                state.handoff_runner,
                state.snapshot_imports.delivery,
            )
        ):
            raise HTTPException(503, "galgame_runner_unavailable")
        async with state.database.sessions() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready", "service": "galgame"}

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
        ready_probe=ready,
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
    app.include_router(snapshot_router)
    app.include_router(project_router)
    app.include_router(asset_read_router)
    app.include_router(task_router)
    app.include_router(upload_router)
    app.include_router(asr_router)
    app.include_router(story_migration_router)
    app.state.capabilities = CapabilityClient(
        service="galgame", credential=credential, catalog=catalog, transport=transport
    )
    app.state.live_authorization = LiveAuthorization(
        service="galgame", credential=credential, transport=transport
    )
    app.state.snapshot_settings = SnapshotSettings(state_root.resolve())
    if web_root is not None:
        release = load_release(web_root, "galgame")
        if schema_path is None or release.api_sha256 != public_contract(
            json.loads(schema_path.read_text()), "galgame", catalog
        ):
            raise ValueError("Galgame 浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)
    uploads = UploadIntakes(app.state.database.sessions, app.state.capabilities)
    app.state.upload_intakes = uploads
    imports = AnnotationImports(app.state, uploads, state_root)
    app.state.annotation_imports = imports
    asr = AsrRunner(app.state, state_root)
    app.state.asr_runner = asr
    exports = ExportRunner(app.state, uploads)
    app.state.export_runner = exports
    handoffs = HandoffRunner(app.state)
    app.state.handoff_runner = handoffs
    archive_delivery = None
    app.state.snapshot_imports = None
    if archive_key is not None:
        archive = ArchiveTransport(
            app.state.capabilities,
            archive_key,
            service="galgame",
            purpose=ARCHIVE_PURPOSE,
            source_path=IMPORT,
            prefix=ARCHIVE_PREFIX,
            domain=ARCHIVE_DOMAIN,
            asset_model=SnapshotArchiveAsset,
            exact_mime=False,
        )
        archive_delivery = SnapshotDelivery(app.state.database.sessions, archive)
        app.state.snapshot_imports = SnapshotImports(app.state, archive, archive_delivery)
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_capability_client(instance):
        async with (
            app.state.capabilities.client,
            app.state.live_authorization.client,
            lifespan(instance),
        ):
            try:
                if run_worker:
                    cleanup_snapshot_staging(app.state.snapshot_settings)
                    await uploads.start()
                    await imports.start()
                    await asr.start()
                    await exports.start()
                    await handoffs.start()
                    if archive_delivery is not None:
                        await archive_delivery.start()
                yield
            finally:
                if archive_delivery is not None:
                    await archive_delivery.stop()
                await handoffs.stop()
                await exports.stop()
                await asr.stop()
                await imports.stop()
                await uploads.stop()

    app.router.lifespan_context = with_capability_client
    expected = {
        (item.method, item.path): item.operation_id
        for item in catalog.operations
        if item.service == "galgame"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if actual != expected:
        raise ValueError("Galgame 公共接口与发布契约不匹配")
    return app
