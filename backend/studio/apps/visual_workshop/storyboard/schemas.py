"""Revisioned shot plans reference existing project resources, never duplicate media."""

import json
import math

from pydantic import Field, model_validator

from studio.apps.visual_workshop.schemas.creative_workflow import (
    Identifier,
    LongText,
    ScriptSource,
    Title,
    WorkflowModel,
)


class StoryboardSource(ScriptSource):
    excerpt: LongText = ""
    start: int | None = Field(default=None, ge=0, le=12000)
    end: int | None = Field(default=None, ge=0, le=12000)

    @model_validator(mode="after")
    def offsets(self):
        if (self.start is None) != (self.end is None):
            raise ValueError("剧本定位范围不完整")
        if self.start is not None and self.end <= self.start:
            raise ValueError("剧本定位范围无效")
        return self


class ShotPrevis(WorkflowModel):
    scene_id: Identifier
    stage_revision: int = Field(ge=0)
    camera_id: str | None = Field(default=None, min_length=1, max_length=160)
    overrides: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def limited_overrides(self):
        # A shot may override staging and cameras, never shared assets or geometry.
        if set(self.overrides) - {"objects", "cameras", "timeline", "view", "life"}:
            raise ValueError("镜头覆盖包含共享舞台属性")
        objects = self.overrides.get("objects", [])
        if not isinstance(objects, list) or len(objects) > 2000:
            raise ValueError("镜头对象覆盖无效")
        for obj in objects:
            if (
                not isinstance(obj, dict)
                or set(obj) - {"id", "position", "rotation", "navigation"}
                or not obj.get("id")
            ):
                raise ValueError("镜头只能修改现有对象的位置、朝向和动作")
        if len({obj["id"] for obj in objects}) != len(objects):
            raise ValueError("镜头对象覆盖标识重复")
        for obj in objects:
            for field in ("position", "rotation"):
                if field in obj:
                    vector = obj[field]
                    if (
                        not isinstance(vector, dict)
                        or set(vector) != {"x", "y", "z"}
                        or any(
                            not isinstance(v, (int, float))
                            or isinstance(v, bool)
                            or not math.isfinite(v)
                            or abs(v) > 10000
                            for v in vector.values()
                        )
                    ):
                        raise ValueError("镜头对象坐标无效")
        if "cameras" in self.overrides:
            cameras = self.overrides["cameras"]
            if (
                not isinstance(cameras, list)
                or len(cameras) > 120
                or any(
                    not isinstance(camera, dict) or not isinstance(camera.get("id"), str)
                    for camera in cameras
                )
            ):
                raise ValueError("镜头机位覆盖无效")
        for field in ("timeline", "view", "life"):
            if field in self.overrides and not isinstance(self.overrides[field], dict):
                raise ValueError("镜头覆盖格式无效")
        pending = [(self.overrides, 0)]
        while pending:
            value, depth = pending.pop()
            if depth > 30:
                raise ValueError("镜头覆盖嵌套过深")
            if isinstance(value, dict):
                if set(value) & {"asset", "url", "path", "provider", "kiln", "sourceUrl"}:
                    raise ValueError("镜头覆盖不能替换素材")
                pending.extend((child, depth + 1) for child in value.values())
            elif isinstance(value, list):
                pending.extend((child, depth + 1) for child in value)
        if len(json.dumps(self.overrides, allow_nan=False).encode()) > 256 * 1024:
            raise ValueError("镜头覆盖不能超过 256 KiB")
        return self


class StoryboardShot(WorkflowModel):
    id: Identifier
    title: Title
    description: LongText = ""
    shot_size: str = Field(default="", max_length=80)
    camera_motion: str = Field(default="", max_length=160)
    duration: float | None = Field(default=None, gt=0, le=3600, allow_inf_nan=False)
    dialogue: LongText = ""
    sound: LongText = ""
    source: StoryboardSource | None = None
    previs: ShotPrevis | None = None
    image_node_id: str | None = Field(default=None, min_length=1, max_length=64)
    video_node_id: str | None = Field(default=None, min_length=1, max_length=64)
    card_ids: list[Identifier] = Field(default_factory=list, max_length=80)
    origin_node_id: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def unique_cards(self):
        if len(self.card_ids) != len(set(self.card_ids)):
            raise ValueError("分镜关联的设定卡不能重复")
        return self


class StoryboardDocument(WorkflowModel):
    shots: list[StoryboardShot] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def unique_shots(self):
        if len({shot.id for shot in self.shots}) != len(self.shots):
            raise ValueError("分镜标识不能重复")
        if len(self.model_dump_json().encode()) > 4 * 1024 * 1024:
            raise ValueError("分镜文档不能超过 4 MiB")
        return self


class StoryboardOut(StoryboardDocument):
    revision: int = Field(ge=0)


class StoryboardUpdate(StoryboardDocument):
    expected_revision: int = Field(ge=0)
