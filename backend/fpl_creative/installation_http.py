"""Public install bound to the original gateway-attested request."""

from fastapi import APIRouter, HTTPException, Request

from app.console.creative_workshop.schemas import CreativeInstallOut, CreativeInstallPreviewIn
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.creative_install_evidence import INSTALL_PATH

from .install_authorization import InstallAuthorizationDenied, InstallSource
from .install_batch import build_install_batch
from .installation_outbox import InstallIntentConflict

router = APIRouter()


@router.post(INSTALL_PATH, response_model=CreativeInstallOut, status_code=201)
async def install(request: Request, body: CreativeInstallPreviewIn):
    coordinator = request.app.state.installation_coordinator
    source = InstallSource(
        request.state.service_assertion,
        request.headers.get("x-fpl-creative-install-evidence", ""),
        await request.body(),
    )
    try:
        owner = await coordinator.authorization.require(source, body)
        if await coordinator.outbox.get(owner, body.release_id) is not None:
            return await coordinator.resume(source, body)
        batch = await build_install_batch(
            request.app.state.database, request.app.state.skill_packer, body
        )
        return await coordinator.install(source, body, batch)
    except (InstallAuthorizationDenied, CapabilityDenied):
        raise HTTPException(403, "creative_install_authorization_denied") from None
    except InstallIntentConflict as exc:
        raise HTTPException(
            409, {"code": "creative_install_conflict", "message": str(exc)}
        ) from exc
    except (CapabilityUnavailable, OSError, ValueError):
        raise HTTPException(503, "creative_install_outcome_unknown") from None
