"""Independent Galgame application with owner-side certification."""

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from fpl_runtime.certification_service import create_certification_app
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.reference_mutations import ReferenceDelivery, ReferenceMutations
from fpl_runtime.retention_client import RetentionClient

from .migrations.registry import MIGRATIONS
from .models import MODELS, GalgameCertificationReceipt, GalgameStoryReferenceMutation
from .projects_http import router as project_router


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
    sessions = app.state.database.sessions
    client = RetentionClient(service="galgame", credential=credential, transport=transport)
    app.state.retention_client = client
    app.state.run_reference_worker = run_worker
    app.state.story_references = ReferenceMutations(
        sessions,
        client,
        service="galgame",
        model=GalgameStoryReferenceMutation,
        public_key=public_key,
        failure=lambda message, status, code: ProjectResourceError(message, code, status),
    )
    app.state.reference_delivery = ReferenceDelivery(
        sessions, client, service="galgame", model=GalgameStoryReferenceMutation
    )
    app.include_router(project_router)
    return app
