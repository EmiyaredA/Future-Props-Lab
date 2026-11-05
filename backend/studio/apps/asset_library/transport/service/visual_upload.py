"""Accept file bytes only for an existing, exact Visual upload intent."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.references.retention_api import checked_intent, private_result
from studio.apps.asset_library.visual.visual_evidence_upload import EvidenceUploadFiles
from studio.apps.asset_library.visual.visual_upload_stages import VisualUploadFiles

router = APIRouter(include_in_schema=False)


class IncomingBody:
    def __init__(self, request):
        self.stream = aiter(request.stream())
        self.pending = b""

    async def read(self, size):
        if not self.pending:
            self.pending = await anext(self.stream, b"")
        chunk, self.pending = self.pending[:size], self.pending[size:]
        return chunk

    async def close(self):
        await self.stream.aclose()


async def upload_intent(request, intent_id, *, evidence=False):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "visual_upload_grant_required")
    _changes, grant, _arguments = await checked_intent(request, intent_id)
    if grant.caller != "visual":
        raise HTTPException(403, "visual_upload_grant_required")
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": grant.owner_id}) as session:
        writer = (EvidenceUploadFiles if evidence else VisualUploadFiles)(
            session, state.settings, grant.owner_id, intent_id
        )
        if request.method == "GET":
            return private_result(await writer.receipt())
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise HTTPException(422, "visual_upload_encoding_forbidden")
        try:
            length = int(request.headers.get("content-length", ""))
        except ValueError as exc:
            raise HTTPException(422, "visual_upload_length_required") from exc

        async def require_active(*, sealed=False):
            token = request.headers["authorization"][7:]
            result = await state.identity.can_prepare_retention(token, sealed_visual_upload=sealed)
            if result is not True:
                raise HTTPException(401 if result is False else 503, "visual_upload_access_ended")

        if evidence:
            return private_result(
                await writer.receive_frames(request.stream(), length, require_active)
            )
        incoming = IncomingBody(request)
        try:
            return private_result(await writer.receive(incoming, length, require_active))
        finally:
            await incoming.close()


@router.api_route("/_internal/v1/visual-upload/{intent_id}", methods=["GET", "POST"])
async def visual_upload(request: Request, intent_id: str):
    return await upload_intent(request, intent_id)


@router.api_route("/_internal/v1/visual-evidence-upload/{intent_id}", methods=["GET", "POST"])
async def visual_evidence_upload(request: Request, intent_id: str):
    return await upload_intent(request, intent_id, evidence=True)
