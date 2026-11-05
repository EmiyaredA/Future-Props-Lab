"""Compatibility quota protocol; settings remain in their registered partition."""

from fastapi import APIRouter, Request

from studio.apps.identity.transport.website.auth import _platform_auth
from studio.apps.model_service.storage.website_policy import write_setting
from studio.apps.model_service.storage.website_settings import read_setting
from studio.assembly.http_dependencies import SessionDep, client_ip
from studio.contracts.model_service.schemas.runtime_quotas import (
    RuntimeQuotas,
    RuntimeQuotasIn,
    RuntimeQuotasOut,
)

router = APIRouter(tags=["platform-governance"])


@router.get("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def get_quotas(request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump())


@router.patch("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def patch_quotas(request: Request, session: SessionDep, body: RuntimeQuotasIn):
    principal = await _platform_auth(request, session)
    return await write_setting(
        session,
        principal,
        "runtime_quotas",
        body.value.model_dump(),
        body.expected_revision,
        client_ip(request),
    )
