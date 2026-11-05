"""Provider diagnostics are separate from catalogue-only HTTP assembly."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.model_service.catalog.service import ResourceNotFoundError
from studio.apps.model_service.diagnostics import DiagnosticCallError, test_model
from studio.apps.model_service.transport.provider_bindings import provider_options
from studio.assembly.http_dependencies import SessionDep
from studio.assembly.model_credentials import CallCredentialDep
from studio.contracts.model_service.schemas.model_service import TestModelOut

router = APIRouter(tags=["models"])


@router.post("/model-entries/{model_id}/test", response_model=TestModelOut)
async def run_model_test(
    session: SessionDep, model_id: str, credential: CallCredentialDep, request: Request
) -> TestModelOut:
    try:
        return await test_model(
            session,
            model_id,
            credential=credential,
            transport_options=lambda base_url: provider_options(request, base_url),
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from None
    except DiagnosticCallError as exc:
        detail = {"code": "model_test_failed", "message": str(exc)}
        if exc.log_id:
            detail["log_id"] = exc.log_id
        raise HTTPException(exc.status_code, detail) from None
