"""Build and check an account's installation preview without creating an intent."""

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, ValidationError

from app.console.creative_workshop.schemas import (
    CreativeInstallPartOut,
    CreativeInstallPreviewIn,
    CreativeInstallPreviewOut,
)
from studio.apps.creative_workshop.install_batch import build_install_batch
from studio.apps.creative_workshop.installation_outbox import InstallIntentConflict
from studio.contracts.creative_workshop.creative_preview import PUBLIC_PREVIEW, preview_path
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter()


class TargetPart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_id: str
    target_name: str
    conflict: bool
    already_installed: bool


class TargetPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parts: list[TargetPart]
    installable: bool


@router.post(PUBLIC_PREVIEW, response_model=CreativeInstallPreviewOut)
async def preview_install(request: Request, body: CreativeInstallPreviewIn):
    state = request.app.state
    capability = state.creative_capabilities
    try:
        try:
            batch = await build_install_batch(state.database, state.skill_packer, body)
        except ValidationError:
            raise HTTPException(422, "目标名称或发布内容无效") from None
        path = preview_path(batch)
        grant = RequestGrant(
            "creative",
            "creative.install-preview.read",
            "POST",
            PUBLIC_PREVIEW,
            "integrations",
            "POST",
            path,
        )
        token = await capability.authorize_request(request.state.service_assertion, grant)
        async with capability.client.stream(
            "POST",
            "http://integrations:8080" + path,
            headers={HEADER: token},
            json=batch.model_dump(mode="json"),
        ) as response:
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            if response.status_code == 409:
                raise InstallIntentConflict("安装预览与已有记录冲突")
            if response.status_code != 200:
                raise CapabilityUnavailable("安装预览暂不可用")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 64 * 1024:
                    raise ValueError("preview exceeds transfer bounds")
        target = TargetPreview.model_validate_json(data)
        if [(part.release_id, part.target_name) for part in target.parts] != [
            (part.release_id, part.target_name) for part in batch.parts
        ]:
            raise ValueError("preview does not match the requested batch")
        return CreativeInstallPreviewOut(
            release_id=batch.root_release_id,
            parts=[
                CreativeInstallPartOut(
                    **result.model_dump(),
                    kind=part.kind,
                    title=part.title,
                    pending_setup=part.kind == "mcp" and part.manifest.get("transport") == "stdio",
                )
                for part, result in zip(batch.parts, target.parts, strict=True)
            ],
            installable=target.installable,
        )
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "creative_preview_denied") from None
    except InstallIntentConflict as exc:
        raise HTTPException(
            409, {"code": "creative_install_conflict", "message": str(exc)}
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, OSError, ValueError):
        raise HTTPException(503, "creative_preview_unavailable") from None
