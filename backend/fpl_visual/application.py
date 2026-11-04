"""Independent Visual application with owner-side certification."""

from app.apps.visual_workshop.models import VisualWorkshopProject
from fpl_runtime.certification_service import create_certification_app

from .migrations.registry import MIGRATIONS
from .models import MODELS, VisualCertificationReceipt


def create_app(*, state_root, public_key, credential, transport=None, run_worker=True):
    return create_certification_app(
        service="visual",
        root=state_root,
        models=MODELS,
        migrations=MIGRATIONS,
        project=VisualWorkshopProject,
        receipts=VisualCertificationReceipt,
        key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )
