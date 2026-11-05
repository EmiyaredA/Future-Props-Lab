"""Resolve project-owned original versions and submit the sealed grid plan."""

from io import BytesIO

import httpx
from pydantic import TypeAdapter

from app.apps.visual_workshop.generation_common import GenerationError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.visual_composition import (
    ASSET_PURPOSE,
    INPUT_HEADER,
    RENDER_PURPOSE,
    GridAsset,
    GridAssetQuery,
    GridItem,
    GridPlan,
)

METADATA = TypeAdapter(list[GridAsset])
MAX_PNG = 96 * 1024**2


class GridOutput:
    content_type = "image/png"

    def __init__(self, batch, grid_size, data):
        side = 2 if grid_size == 4 else 3
        self.filename = f"grid-{side}x{side}-{batch[:8]}.png"
        self.data = BytesIO(data)

    async def read(self, size=-1):
        return self.data.read(size)

    async def seek(self, offset):
        self.data.seek(offset)

    async def close(self):
        self.data.close()


class GridPeer:
    def __init__(self, client, assertion, source):
        self.peer, self.assertion, self.source = client, assertion, source

    async def grant(self, purpose, service, target):
        try:
            return await self.peer.authorize_request(
                self.assertion,
                RequestGrant("visual", purpose, "POST", self.source, service, "POST", target),
            )
        except CapabilityDenied as exc:
            raise GenerationError(
                "宫格合成授权已结束", code="visual_grid_authority_ended", status=exc.status
            ) from exc

    async def plan(self, project, batch, source_items):
        try:
            ids = sorted(item["asset_id"] for item in source_items)
            query = GridAssetQuery(asset_ids=ids)
            target = query.path(project, batch)
            token = await self.grant(ASSET_PURPOSE, "assets", target)
            response = await self.peer.client.post(
                "http://assets:8080" + target,
                headers={HEADER: token},
                json=query.model_dump(),
            )
            self.check(response)
            rows = METADATA.validate_json(response.content)
            if [item.id for item in rows] != ids or any(
                item.media_kind != "image" for item in rows
            ):
                raise ValueError("grid source projection is not exact")
            assets = {item.id: item for item in rows}
            return GridPlan(
                items=[
                    GridItem(
                        asset_id=source["asset_id"],
                        revision=assets[source["asset_id"]].revision,
                        byte_size=assets[source["asset_id"]].byte_size,
                        caption=source.get("caption") or "",
                    )
                    for source in source_items
                ]
            )
        except (httpx.HTTPError, CapabilityUnavailable) as exc:
            raise GenerationError(
                "宫格素材暂不可用", code="visual_grid_unavailable", status=503
            ) from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise GenerationError("宫格原件或字幕无效", code="visual_grid_invalid_inputs") from exc

    @staticmethod
    def check(response):
        if response.status_code in {401, 403, 404, 409, 413, 422}:
            data = response.json()
            raise GenerationError(
                data.get("title") or "宫格合成失败",
                code=data.get("code") or "visual_grid_failed",
                status=response.status_code,
            )
        response.raise_for_status()

    async def render(self, project, batch, plan):
        target = plan.path(project, batch)
        source = plan.scope.path(project, batch)
        token = await self.grant(RENDER_PURPOSE, "rendering", target)
        source_token = await self.grant(ASSET_PURPOSE, "assets", source)
        try:
            async with self.peer.client.stream(
                "POST",
                "http://rendering:8080" + target,
                headers={HEADER: token, INPUT_HEADER: source_token, "Accept-Encoding": "identity"},
                json=plan.model_dump(),
                timeout=httpx.Timeout(240, connect=5),
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    self.check(response)
                if response.headers.get("content-type") != "image/png":
                    raise ValueError("grid result is not a PNG")
                data = bytearray()
                async for chunk in response.aiter_bytes(1024 * 1024):
                    if len(data) + len(chunk) > MAX_PNG:
                        raise ValueError("grid result is oversized")
                    data.extend(chunk)
                if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("invalid grid PNG signature")
                return GridOutput(batch, len(plan.items), data)
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise GenerationError(
                "宫格合成暂不可用", code="visual_grid_unavailable", status=503
            ) from exc
