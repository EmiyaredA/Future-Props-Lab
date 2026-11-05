"""Existing multipart archive import entry for the independent service."""

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.http_bindings import SessionDep
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from app.deps import StudioAuth
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable

from .archive_import import import_archive

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


@router.post("/imports", response_model=ThoughtImportOut)
async def imports(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    upload: UploadFile = File(),
    knowledge_base_id: str | None = None,
    expected_revision: int | None = Query(default=None, ge=0),
):
    app = request.app.state
    if app.thought_archive_delivery is None:
        await upload.close()
        raise HTTPException(503, "thought_archive_unavailable")
    try:
        return await import_archive(
            session,
            owner=principal.user_id,
            upload=upload,
            request_key=request.headers.get("idempotency-key"),
            knowledge_base_id=knowledge_base_id,
            expected_revision=expected_revision,
            assertion=request.state.service_assertion,
            identity=app.identity,
            limits=app.thought_backup_limits,
            file_limit=app.thought_upload_configuration.maximum_bytes,
            delivery=app.thought_archive_delivery,
        )
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "thought_archive_denied") from None
    except CapabilityUnavailable:
        raise HTTPException(503, "thought_archive_unconfirmed") from None
