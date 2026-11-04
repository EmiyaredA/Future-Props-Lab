"""Set up an owned installation and settle only an authenticated target receipt."""

import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.console.creative_workshop.schemas import CreativeInstallOut, CreativeStdioSetupIn
from app.deps import SessionDep, StudioAuth
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.creative_integrations import CreativeStdioConfiguration
from fpl_runtime.creative_source_evidence import strict_json
from fpl_runtime.creative_stdio import PRIVATE_STDIO, PUBLIC_STDIO, stdio_source
from fpl_runtime.delegation import RequestGrant

from .stdio_records import StdioRecordError, installation_part, record_setup

router = APIRouter()


async def target_setup(request, installation_id, configuration):
    state = request.app.state
    target = state.installation_coordinator.target
    signer = target.authenticator
    checksum = signer.stdio_digest(installation_id, configuration)
    path = f"{PRIVATE_STDIO}{installation_id}/{checksum}"
    nonce = secrets.token_hex(16)
    capabilities = state.creative_capabilities
    grant = RequestGrant(
        "creative",
        "creative.install-stdio.write",
        "POST",
        request.url.path,
        "integrations",
        "POST",
        path,
    )
    token = await capabilities.authorize_request(request.state.service_assertion, grant)
    async with capabilities.client.stream(
        "POST",
        "http://integrations:8080" + path,
        headers={
            HEADER: token,
            "Authorization": "Bearer " + target.peer,
            "X-Fpl-Creative-Nonce": nonce,
        },
        json=configuration.model_dump(mode="json"),
    ) as response:
        if response.status_code in {401, 403, 404, 409, 422}:
            raise StdioRecordError(response.status_code, "creative_stdio_rejected")
        if response.status_code != 200:
            raise CapabilityUnavailable("stdio setup outcome unknown")
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > 8192:
                raise ValueError("stdio receipt exceeds bounds")
        signer.verify(
            response.headers.get("x-fpl-creative-result", ""),
            action="setup",
            operation=installation_id,
            fingerprint=checksum,
            nonce=nonce,
            status=200,
            body=bytes(raw),
        )
    return strict_json(bytes(raw))


@router.post(PUBLIC_STDIO, response_model=CreativeInstallOut)
async def configure_stdio(
    session: SessionDep,
    principal: StudioAuth,
    installation_id: str,
    body: CreativeStdioSetupIn,
    request: Request,
):
    if not stdio_source(request.method, request.url.path):
        raise HTTPException(404, "not_found")
    try:
        configuration = CreativeStdioConfiguration.model_validate(body.model_dump())
    except ValidationError:
        raise HTTPException(422, "creative_stdio_configuration_invalid") from None
    try:
        await installation_part(session, installation_id, configuration.release_id)
        await session.rollback()
        receipt = await target_setup(request, installation_id, configuration)
        return await record_setup(
            request.app.state.database,
            principal.user_id,
            installation_id,
            configuration.release_id,
            receipt,
        )
    except StdioRecordError as exc:
        raise HTTPException(exc.status, exc.code) from None
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "creative_stdio_denied") from None
    except (httpx.HTTPError, CapabilityUnavailable, ValueError):
        raise HTTPException(503, "creative_stdio_outcome_unknown") from None
