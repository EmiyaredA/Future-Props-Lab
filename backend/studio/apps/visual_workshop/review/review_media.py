"""Versioned evidence transport shared by automatic reviews and interval sampling."""

import base64
import json
from contextlib import asynccontextmanager

import httpx
from pydantic import TypeAdapter

from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.apps.visual_workshop.uploads import UploadedAsset
from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_review import MAX_IMAGE_BASE64, ReviewImage
from studio.contracts.visual_workshop.visual_samples import (
    ASSET_PURPOSE,
    FRAMES_HEADER,
    INPUT_HEADER,
    RENDER_PURPOSE,
    SampleAssetQuery,
    SamplePlan,
    VisualEvidenceUpload,
)
from studio.runtime.http.capability_client import CapabilityDenied
from studio.runtime.http.framed_media import SIZE

ASSETS = TypeAdapter(list[UploadedAsset])


def unavailable():
    return AcceptanceError("验收取样暂不可用", "visual_sample_unavailable", 503)


def check(response):
    if response.status_code in {401, 403, 404, 409, 413, 422, 429}:
        data = response.json()
        raise AcceptanceError(
            data.get("title") or "验收取样失败",
            data.get("code") or "visual_sample_failed",
            response.status_code,
        )
    response.raise_for_status()


class ReviewMedia:
    def __init__(self, peer, assertion, source):
        self.peer, self.assertion, self.source = peer, assertion, source

    async def grant(self, purpose, service, path):
        try:
            return await self.peer.authorize_request(
                self.assertion,
                RequestGrant("visual", purpose, "POST", self.source, service, "POST", path),
            )
        except CapabilityDenied as exc:
            raise AcceptanceError(
                "验收取样授权已结束", "visual_sample_authority_ended", exc.status
            ) from exc

    async def metadata(self, project, run, identity, *, kind="video"):
        query = SampleAssetQuery(asset_ids=[identity], media_kind=kind)
        path = query.path(project, run)
        token = await self.grant(ASSET_PURPOSE, "assets", path)
        reply = await self.peer.client.post(
            "http://assets:8080" + path, headers={HEADER: token}, json=query.model_dump()
        )
        check(reply)
        source = LibraryAssetDescription.model_validate_json(reply.content)
        if source.id != identity or source.media_kind != kind:
            raise ValueError("review source media changed")
        return source

    @asynccontextmanager
    async def render(self, project, run, identity, *, positions_ms=None, mode="interval"):
        kind = "image" if mode == "review-image" else "video"
        source = await self.metadata(project, run, identity, kind=kind)
        plan = SamplePlan(source=source, positions_ms=positions_ms or [], mode=mode)
        target = plan.path(project, run)
        token = await self.grant(RENDER_PURPOSE, "rendering", target)
        original = await self.grant(ASSET_PURPOSE, "assets", plan.scope.path(project, run))
        async with self.peer.client.stream(
            "POST",
            "http://rendering:8080" + target,
            headers={HEADER: token, INPUT_HEADER: original, "Accept-Encoding": "identity"},
            json=plan.model_dump(),
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code != 200:
                await response.aread()
                check(response)
            yield response

    async def model_image(self, project, run, evidence):
        async with self.render(project, run, evidence["asset_id"], mode="review-image") as response:
            length = int(response.headers["Content-Length"])
            if (
                response.headers.get("Content-Type") != "image/jpeg"
                or response.headers.get("Content-Encoding", "identity") != "identity"
                or not 1 <= length <= MAX_IMAGE_BASE64 // 4 * 3
            ):
                raise ValueError("review JPEG metadata changed")
            jpeg = bytearray()
            async for chunk in response.aiter_bytes(128 * 1024):
                jpeg.extend(chunk)
                if len(jpeg) > length:
                    raise ValueError("review JPEG exceeded its declared size")
            if len(jpeg) != length or not jpeg.startswith(b"\xff\xd8\xff"):
                raise ValueError("review JPEG data changed")
        return ReviewImage(**evidence, jpeg_base64=base64.b64encode(jpeg).decode())


def validate_framed(response, length):
    if (
        response.headers.get("Content-Type") != "application/octet-stream"
        or response.headers.get("Content-Encoding", "identity") != "identity"
        or int(response.headers["Content-Length"]) != length
    ):
        raise ValueError("review media stream changed")


def evidence_manifest(response, project, source_id):
    media = VisualEvidenceUpload(
        project_id=project,
        source_asset_id=source_id,
        frames=json.loads(response.headers[FRAMES_HEADER]),
    )
    length = sum(SIZE.size + item.byte_size for item in media.frames)
    validate_framed(response, length)
    return media, length


async def stage_evidence(client, prepared, source, length, media):
    path = client.assets_url + f"/_internal/v1/visual-evidence-upload/{prepared.asset_intent_id}"
    headers = {"Authorization": "Bearer " + prepared.authority}
    try:
        reply = await client.client.post(
            path,
            headers={**headers, "Content-Length": str(length)},
            content=source.aiter_bytes(1024 * 1024),
            timeout=180,
        )
    except httpx.TransportError:
        reply = await client.client.get(path, headers=headers)
    check(reply)
    assets = ASSETS.validate_python(reply.json()["items"])
    if len({row.id for row in assets}) != len(media.frames):
        raise ValueError("unexpected evidence asset count")
    for row, frame in zip(assets, media.frames, strict=True):
        if (
            row.original_filename != frame.filename
            or row.revision != 0
            or row.media_kind != "image"
            or row.mime_type != "image/png"
            or row.byte_size != frame.byte_size
        ):
            raise ValueError("evidence file metadata changed")
    return assets
