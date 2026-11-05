"""Import a source only when the gateway attested the exact browser body."""

import base64
from uuid import NAMESPACE_URL, uuid5

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request

from app.console.creative_workshop.catalog import CreativeCatalog, CreativeError
from app.console.creative_workshop.files import CreativeFileError
from app.console.creative_workshop.schemas import CreativeImportIn, CreativeItemOut
from app.integrations.common import IntegrationValidationError
from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.contracts.creative_workshop.creative_source_evidence import (
    PURPOSE,
    SOURCE_PATH,
    SOURCE_TRANSFER,
    verify_source_request,
)
from studio.contracts.creative_workshop.creative_source_snapshot import (
    CreativeSource,
    CreativeSourcePayload,
)
from studio.contracts.creative_workshop.creative_transport import CreativeAttestedRequest
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter()


class HttpSources:
    def __init__(self, state, proof, envelope):
        self.state, self.proof, self.envelope = state, proof, envelope

    async def snapshot(self, *, owner, kind, source_id):
        proof, capability = self.proof, self.state.creative_capabilities
        if (owner, kind, source_id) != (proof.owner_user_id, proof.kind, proof.source_id):
            raise CapabilityDenied(403)
        path = f"{SOURCE_TRANSFER}{kind}/{source_id}/{proof.body_sha256}"
        grant = RequestGrant("creative", PURPOSE, "POST", SOURCE_PATH, "integrations", "POST", path)
        token = await capability.authorize_request(self.envelope.assertion, grant)
        async with capability.client.stream(
            "POST",
            "http://integrations:8080" + path,
            headers={HEADER: token},
            json=self.envelope.model_dump(mode="json"),
        ) as response:
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            if response.status_code == 404:
                return None
            if response.status_code == 422:
                raise CreativeError("来源文件不可用")
            if response.status_code != 200:
                raise CapabilityUnavailable("来源服务暂不可用")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 28 * 1024 * 1024:
                    raise CapabilityUnavailable("来源归档超过传输限制")
        try:
            payload = CreativeSourcePayload.model_validate_json(data)
        except ValueError:
            raise CapabilityUnavailable("来源服务返回无效结果") from None
        active = await self.state.identity.status(
            assertion=self.envelope.assertion, method="POST", path=SOURCE_PATH
        )
        if active is None:
            raise CapabilityUnavailable("来源授权暂不可用")
        if not active:
            raise CapabilityDenied(403)
        return CreativeSource(**payload.model_dump())


@router.post(SOURCE_PATH, response_model=CreativeItemOut, status_code=201)
async def import_item(
    request: Request, body: CreativeImportIn, session: SessionDep, principal: StudioAuth
):
    state = request.app.state
    raw = await request.body()
    try:
        envelope = CreativeAttestedRequest(
            assertion=request.state.service_assertion,
            evidence=request.headers.get("x-fpl-creative-source-evidence", ""),
            body_base64=base64.b64encode(raw).decode("ascii"),
        )
        actor, proof = verify_source_request(
            envelope.assertion, envelope.evidence, raw, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(403, "creative_source_forbidden") from None
    if actor.user_id != principal.user_id or (proof.kind, proof.source_id) != (
        body.kind,
        body.source_id,
    ):
        raise HTTPException(403, "creative_source_forbidden")
    session.info["creative_sources"] = HttpSources(state, proof, envelope)
    item_id = str(
        uuid5(
            NAMESPACE_URL,
            f"fpl:creative-import:{actor.user_id}:{proof.request_id}:{proof.body_sha256}",
        )
    )
    try:
        return await CreativeCatalog(session, principal).import_source(
            body.kind, body.source_id, request_item_id=item_id
        )
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "creative_source_forbidden") from None
    except (httpx.HTTPError, CapabilityUnavailable):
        raise HTTPException(503, "creative_source_unavailable") from None
    except CreativeError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc
    except (CreativeFileError, IntegrationValidationError) as exc:
        raise HTTPException(422, {"code": "invalid_upload", "message": str(exc)}) from exc
