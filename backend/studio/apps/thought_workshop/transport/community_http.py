"""Browser community-file adapter using only short-lived service capabilities."""

import json
from dataclasses import asdict

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from studio.apps.thought_workshop.community.community_access import published_asset
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import CommunityDirectoryDep, CommunitySessionDep
from studio.apps.thought_workshop.publication.access import publication
from studio.apps.thought_workshop.publication.sessions import source_sessions
from studio.assembly.http_dependencies import PublicStudioAuth
from studio.contracts.thought_workshop.community_assets import (
    CommunityAssetRequest,
    verify_community_asset,
)
from studio.runtime.files.image_sizes import ThumbnailSize

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

    async def open(self, request, evidence, size):
        body = CommunityAssetRequest(
            source_assertion=request.state.service_assertion,
            source_method=request.method,
            source_path=request.url.path,
            evidence=asdict(evidence),
            size=size,
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
            if upstream.status_code == 422 and size is not None:
                try:
                    data = bytearray()
                    async for chunk in upstream.aiter_bytes():
                        if len(data) + len(chunk) > 8192:
                            raise ValueError("invalid thumbnail response")
                        data.extend(chunk)
                    code = json.loads(data)["code"]
                finally:
                    await upstream.aclose()
                messages = {
                    "thumbnail_unsupported": "此素材暂不支持缩略预览",
                    "thumbnail_too_large": "图片超过缩略图解码限制",
                }
                if code in messages:
                    raise HTTPException(422, {"code": code, "message": messages[code]})
                raise ValueError("invalid thumbnail response")
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
    request,
    session,
    principal,
    publication_id,
    asset_id,
    *,
    accounts,
    note_id=None,
    cover=False,
    size=None,
):
    files = getattr(request.app.state, "community_files", None)
    if not isinstance(files, CommunityFiles):
        raise HTTPException(503, "community_asset_unavailable")
    try:
        async with source_sessions(session)() as source:
            if cover:
                asset_id = (await publication(source, publication_id)).cover_asset_id
            evidence = await published_asset(
                source,
                principal,
                publication_id,
                asset_id,
                accounts=accounts.for_session(source),
                note_id=note_id,
                cover=cover,
                allow_draft=note_id is not None,
            )
        return await files.open(request, evidence, size)
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/publications/{publication_id}/cover")
async def cover(
    request: Request,
    publication_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    size: ThumbnailSize | None = None,
):
    return await _content(
        request, session, principal, publication_id, None, accounts=accounts, cover=True, size=size
    )


@router.get("/publications/{publication_id}/assets/{asset_id}/content")
async def asset(
    request: Request,
    publication_id: str,
    asset_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    note_id: str | None = None,
    size: ThumbnailSize | None = None,
):
    return await _content(
        request,
        session,
        principal,
        publication_id,
        asset_id,
        accounts=accounts,
        note_id=note_id,
        size=size,
    )
