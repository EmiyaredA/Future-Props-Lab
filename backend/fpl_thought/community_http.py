"""Browser community-file adapter using only short-lived service capabilities."""

from dataclasses import asdict

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.http_bindings import CommunitySessionDep
from app.apps.thought_workshop.publication.access import publication
from app.apps.thought_workshop.publication.sessions import source_sessions
from app.deps import PublicStudioAuth
from app.runtime.image_sizes import ThumbnailSize
from fpl_runtime.community_assets import CommunityAssetRequest, verify_community_asset

from .community_access import published_asset

router = APIRouter(prefix="/thought-workshop/community", tags=["knowledge-community"])


class CommunityFiles:
    def __init__(
        self,
        *,
        credential,
        public_key,
        transport=None,
        identity_url="http://identity:8080",
        assets_url="http://assets:8080",
    ):
        if not isinstance(credential, str) or len(credential) < 32:
            raise ValueError("社区素材请求需要 Thought 专属凭据")
        self.credential, self.public_key = credential, public_key
        self.identity_url, self.assets_url = identity_url, assets_url
        self.client = httpx.AsyncClient(
            transport=transport, trust_env=False, follow_redirects=False, timeout=10
        )

    async def open(self, request, evidence):
        body = CommunityAssetRequest(
            source_assertion=request.state.service_assertion,
            source_method=request.method,
            source_path=request.url.path,
            evidence=asdict(evidence),
        )
        try:
            response = await self.client.post(
                self.identity_url + "/_internal/v1/thought-community-assets/authorize",
                headers={"Authorization": "Bearer " + self.credential},
                json=body.model_dump(mode="json"),
            )
            if response.status_code in (401, 403):
                raise HTTPException(response.status_code, "community_asset_authorization_denied")
            if response.status_code != 200:
                raise ValueError("identity unavailable")
            token = response.json()["authority"]
            actor, source = verify_community_asset(token, public_key=self.public_key)
            if source != body or actor.user_id != evidence.viewer_id:
                raise ValueError("mismatched community authority")
            upstream = await self.client.send(
                self.client.build_request(
                    "GET",
                    self.assets_url + "/_internal/v1/thought-community-assets/content",
                    headers={"Authorization": "Bearer " + token, "Accept-Encoding": "identity"},
                ),
                stream=True,
            )
            if upstream.status_code != 200:
                await upstream.aclose()
                if upstream.status_code in (401, 403, 404):
                    raise HTTPException(404, "community_asset_not_found")
                raise ValueError("asset unavailable")
            if upstream.headers.get("content-encoding", "identity") != "identity":
                await upstream.aclose()
                raise ValueError("unsupported asset encoding")
            mime = upstream.headers.get("content-type", "application/octet-stream")
            length = upstream.headers.get("content-length")
            headers = {
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
            }
            if length and length.isascii() and length.isdigit():
                headers["Content-Length"] = length

            async def stream():
                try:
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
                finally:
                    await upstream.aclose()

            return StreamingResponse(stream(), media_type=mime, headers=headers)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, jwt.InvalidTokenError):
            raise HTTPException(503, "community_asset_unavailable") from None

    async def close(self):
        await self.client.aclose()


async def _content(
    request, session, principal, publication_id, asset_id, note_id=None, cover=False
):
    files = getattr(request.app.state, "community_files", None)
    if not isinstance(files, CommunityFiles):
        raise HTTPException(503, "community_asset_unavailable")
    try:
        async with source_sessions(session)() as source:
            if cover:
                asset_id = (await publication(source, publication_id)).cover_asset_id
            evidence = await published_asset(
                source, principal, publication_id, asset_id, note_id=note_id, cover=cover
            )
        return await files.open(request, evidence)
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/publications/{publication_id}/cover")
async def cover(
    request: Request,
    publication_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    size: ThumbnailSize | None = None,  # noqa: ARG001
):
    return await _content(request, session, principal, publication_id, None, cover=True)


@router.get("/publications/{publication_id}/assets/{asset_id}/content")
async def asset(
    request: Request,
    publication_id: str,
    asset_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    note_id: str | None = None,
    size: ThumbnailSize | None = None,  # noqa: ARG001
):
    return await _content(request, session, principal, publication_id, asset_id, note_id=note_id)
