"""Independent Visual application with owner-side certification."""

from app.apps.visual_workshop.models import VisualWorkshopProject
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.reference_runtime import install_reference_runtime

from .migrations.registry import MIGRATIONS
from .models import MODELS, VisualCanvasReferenceMutation, VisualCertificationReceipt
from .outputs_http import router as outputs_router
from .projects_http import router as project_router


def create_app(*, state_root, public_key, credential, catalog, transport=None, run_worker=True):
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
    return app
