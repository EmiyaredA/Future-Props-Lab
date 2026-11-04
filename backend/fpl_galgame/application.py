"""Independent Galgame application with owner-side certification."""

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from fpl_runtime.certification_service import create_certification_app

from .migrations.registry import MIGRATIONS
from .models import MODELS, GalgameCertificationReceipt


def create_app(*, state_root, public_key, credential, transport=None, run_worker=True):
    return create_certification_app(
        service="galgame",
        root=state_root,
        models=MODELS,
        migrations=MIGRATIONS,
        project=GalgameWorkshopProject,
        receipts=GalgameCertificationReceipt,
        key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )
