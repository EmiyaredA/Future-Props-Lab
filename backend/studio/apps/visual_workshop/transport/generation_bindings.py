"""Bind request identity and concrete generation dependencies at the HTTP boundary."""

from studio.apps.visual_workshop.generation.generation_intake import GenerationIntake
from studio.apps.visual_workshop.generation.generation_peer import GenerationPeer
from studio.apps.visual_workshop.generation_errors import GenerationError
from studio.apps.visual_workshop.storage.generation_intake import SqlGenerationIntake
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


def generation_intake(request, session, owner):
    state = request.app.state
    if state.visual_generation_peer is None:
        raise GenerationError(
            "生成执行服务尚未就绪", code="visual_generation_unavailable", status=503
        )
    peer = GenerationPeer(
        state.capabilities,
        state.visual_generation_peer,
        assertion=request.state.service_assertion,
        source=request.url.path,
    )
    store = SqlGenerationIntake(
        session,
        owner,
        sessions=state.database.sessions,
        source=request.url.path,
        assertion=request.state.service_assertion,
    )
    delivery = state.reference_delivery

    async def deliver_reference(identity):
        try:
            await delivery.deliver(owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise GenerationError(
                "生成输入正在结算", code="visual_generation_unavailable", status=503
            ) from exc

    return GenerationIntake(store, peer, deliver_reference)
