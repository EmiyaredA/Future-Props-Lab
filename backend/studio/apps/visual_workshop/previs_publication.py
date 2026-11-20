"""Idempotency and provenance for one output of a saved previs scene."""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_serializer,
    model_validator,
)

from studio.apps.visual_workshop.canvas_documents import VisualCanvasError
from studio.apps.visual_workshop.previs_scenes import PrevisScenes
from studio.runtime.database.operation_receipts import OperationError, record, replay

RECEIPT_KIND = "visual"
UUID = Annotated[str, Field(pattern=r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")]


class PrevisPublication(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    scene_id: UUID
    scene_revision: int = Field(ge=0)
    shot_number: int | None = Field(None, ge=1, le=120)
    artifact_kind: Literal["frame", "views", "clip", "previs"] | None = None
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def check_artifact(self):
        if self.artifact_kind and (self.artifact_kind == "previs") == bool(self.shot_number):
            raise ValueError("逐镜素材需要镜号，整场预演小样不带镜号")
        return self

    @model_serializer(mode="wrap")
    def preserve_legacy_digest(self, serialize):
        value = serialize(self)
        if self.artifact_kind is None:
            value.pop("artifact_kind", None)
        return value

    @property
    def node_id(self):
        return f"previs-{self.request_id}"

    @property
    def tags(self):
        tags = ["白模预演", f"{self.scene_id}@{self.scene_revision}"]
        return [*tags, f"第{self.shot_number}镜"] if self.shot_number else tags


class PublicationReceipt(BaseModel):
    asset_request_id: str | None


def publication_resource_id(project_id):
    return f"previs-upload:{project_id}"


def parse_publication(value):
    if value is None:
        return None
    try:
        return PrevisPublication.model_validate_json(value)
    except ValidationError as exc:
        raise VisualCanvasError("白模导出来源无效") from exc


class PrevisPublicationScope:
    def __init__(self, session, owner, project, publication):
        self.session, self.owner, self.project = session, owner, project
        self.publication = publication

    def _scope(self):
        return dict(
            owner_user_id=self.owner,
            kind=RECEIPT_KIND,
            resource_id=publication_resource_id(self.project),
            body=self.publication,
        )

    async def check_replay(self):
        try:
            result = await replay(self.session, **self._scope())
        except OperationError as exc:
            raise VisualCanvasError(str(exc), code=exc.code, status=exc.status) from exc
        return PublicationReceipt.model_validate(result) if result else None

    async def require_current(self):
        scene = await PrevisScenes(self.session, self.owner).get(
            self.project, self.publication.scene_id
        )
        if scene.revision != self.publication.scene_revision:
            raise VisualCanvasError(
                "预演场景版本已变化，请重新导出", code="previs_revision_conflict", status=409
            )

    def verify_upload(self, description):
        if self.publication.sha256 != description.content_sha256:
            raise VisualCanvasError("白模导出文件摘要不匹配")
        kind = self.publication.artifact_kind or (
            "frame" if self.publication.shot_number else "previs"
        )
        allowed = {
            "frame": {"image/png"},
            "views": {"image/jpeg"},
            "clip": {"video/mp4", "video/webm"},
            "previs": {"video/mp4", "video/webm"},
        }[kind]
        if description.mime_type not in allowed:
            raise VisualCanvasError("白模回填文件类型与导出内容不匹配")

    def record(self, asset_request_id=None):
        record(
            self.session,
            **self._scope(),
            result=PublicationReceipt(asset_request_id=asset_request_id),
        )
