"""Independent Galgame application with owner-side certification."""

import json
from contextlib import asynccontextmanager

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from app.capabilities.asset_store.project_snapshots import cleanup_snapshot_staging
from fpl_runtime.archive_transport import ArchiveTransport, SnapshotArchiveAsset
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.galgame_snapshot import ARCHIVE_DOMAIN, ARCHIVE_PREFIX, ARCHIVE_PURPOSE, IMPORT
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime
from fpl_runtime.web import attach_web, load_release

from .annotation_runner import AnnotationImports
from .asr_routes import router as asr_router
from .asr_runner import AsrRunner
from .asset_read_routes import router as asset_read_router
from .migrations.registry import MIGRATIONS
from .models import MODELS, GalgameCertificationReceipt, GalgameStoryReferenceMutation
from .projects_http import router as project_router
from .snapshot_exports import SnapshotSettings
from .snapshot_http import router as snapshot_router
from .snapshot_imports import SnapshotDelivery, SnapshotImports
from .story_migration_http import router as story_migration_router
from .task_http import router as task_router
from .upload_http import router as upload_router
from .upload_intakes import UploadIntakes

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
                    if archive_delivery is not None:
                        await archive_delivery.start()
                yield
            finally:
                if archive_delivery is not None:
                    await archive_delivery.stop()
                await asr.stop()
                await imports.stop()
                await uploads.stop()

    app.router.lifespan_context = with_capability_client
    return app
