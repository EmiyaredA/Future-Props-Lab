"""Bind a Galgame exact frame to its frozen Story and versioned originals."""

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.galgame_workshop.galgame_assets import SOURCE
from studio.contracts.motion_compositor.motion_preview import DIGEST
from studio.contracts.motion_compositor.motion_snapshot import SnapshotScope

FRAMES = "/_internal/v1/galgame-render-frames"
INPUTS = "/_internal/v1/galgame-render-frame-inputs"
RENDER_PURPOSE = "galgame.frame.render"
INPUT_PURPOSE = "galgame.frame-originals.read"
INPUT_HEADER = "X-Fpl-Galgame-Render-Inputs"
MAX_FRAME_REQUEST = 16 * 1024 * 1024


class GalgameRenderPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    document: dict
    payload: dict
    scope: SnapshotScope
    sizes: dict[str, int]
    durations: dict[str, int]
    fragment_durations_ms: list[int] = Field(max_length=20_000)
    total_ms: int = Field(ge=0, strict=True)

    @model_validator(mode="after")
    def exact_scope(self):
        raw_assets = self.document.get("assets")
        if not isinstance(raw_assets, list) or any(
            not isinstance(asset, dict) or not isinstance(asset.get("fileId"), str)
            for asset in raw_assets
        ):
            raise ValueError("Story 素材描述无效")
        ids = {item.id for item in self.scope.files}
        selected = self.payload.get("resolvedFragmentIds")
        if (
            not isinstance(selected, list)
            or len(selected) != len(self.fragment_durations_ms)
            or any(
                type(duration) is not int or duration < 0 for duration in self.fragment_durations_ms
            )
            or ids != self.sizes.keys()
            or not ids <= {asset["fileId"] for asset in raw_assets}
            or any(size <= 0 for size in self.sizes.values())
        ):
            raise ValueError("渲染时间或原件范围无效")
        return self


class GalgameFrame(GalgameRenderPlan):
    time_ms: int = Field(ge=0, strict=True)
    width: int = Field(ge=320, le=1920, strict=True)

    @model_validator(mode="after")
    def time_inside_plan(self):
        if self.time_ms > self.total_ms:
            raise ValueError("渲染时间超出范围")
        return self


def frame_target(method, path):
    return method == "POST" and re.fullmatch(rf"{FRAMES}/({ID})/({DIGEST})/({DIGEST})", path)


def inputs_target(method, path):
    return method == "POST" and re.fullmatch(rf"{INPUTS}/({ID})/({DIGEST})", path)


def frame_grant(grant):
    if grant.caller != "galgame" or grant.source_method != "POST":
        return False
    destination = (grant.target_service, grant.purpose)
    if destination == ("rendering", RENDER_PURPOSE):
        scope = frame_target(grant.target_method, grant.target_path)
    elif destination == ("assets", INPUT_PURPOSE):
        scope = inputs_target(grant.target_method, grant.target_path)
    else:
        return False
    return bool(scope and grant.source_path == f"{SOURCE}/{scope[1]}/video-exports/frame")
