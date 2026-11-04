"""Apply Canvas edits with account- and project-bound Assets preparation."""

from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select

from app.apps.visual_workshop.canvas_asset_values import existing_assets, expected_assets
from app.apps.visual_workshop.canvas_documents import CanvasDocuments
from app.apps.visual_workshop.canvas_values import canvas_out
from app.apps.visual_workshop.operation_values import transform
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentOut
from app.runtime.ids import new_id
from app.runtime.operation_receipts import record, replay
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError

from .projects import Projects

PREFIX = "/v1/visual-workshop/projects"


def conflict(expected, current):
    return RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))


class CanvasWrites:
    def __init__(self, session, owner, references, assertion):
        self.session, self.owner = session, owner
        self.references, self.assertion = references, assertion
        self.projects = Projects(session, owner)

    async def _prepare(
        self, project_id, *, expected, method, path, files=(), used=None, carried=None
    ):
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method=method,
                source_path=path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="canvas",
                    resource_id=project_id,
                    expected_resource_revision=expected,
                    asset_ids=sorted(files),
                    metadata_asset_ids=used,
                    carried_asset_ids=carried,
                ),
            )
        except ValidationError as exc:
            raise ProjectResourceError("节点素材引用无效或过多", "asset_not_found", 422) from exc
        except CapabilityDenied as exc:
            if exc.code == "canvas_asset_scope":
                raise ProjectResourceError("节点素材不属于当前项目", "scope_mismatch", 422) from exc
            if exc.status == 404:
                raise ProjectResourceError("节点素材不存在", "asset_not_found", 422) from exc
            if exc.status == 409 and expected >= 0:
                current = await self.projects.canvas(project_id)
                if current.revision != expected:
                    raise conflict(expected, current) from exc
                raise ProjectResourceError(
                    "素材引用状态未核验", "retention_unconfirmed", 503
                ) from exc
            raise ProjectResourceError(
                "素材引用准备被拒绝", "retention_denied", exc.status
            ) from exc
        except CapabilityUnavailable as exc:
            raise ProjectResourceError("素材引用结果未确认", "retention_unconfirmed", 503) from exc

    async def create_project(self, body):
        project_id = new_id()
        prepared = await self._prepare(project_id, expected=-1, method="POST", path=PREFIX)

        async def apply():
            return await self.projects.create(body, project_id=project_id)

        return await self.references.commit_source(self.session, prepared, apply)

    async def _history_assets(self, project_id, node_ids):
        if not node_ids:
            return set()
        outputs = await self.session.scalars(
            select(VisualNodeOutput).where(
                VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id.in_(node_ids)
            )
        )
        return {
            value
            for row in outputs
            for value in (
                row.asset_id,
                row.inspection_asset_id,
                *(item.get("asset_id") for item in row.input_snapshot or ()),
            )
            if value
        }

    async def put(self, project_id, body):
        row = await self.projects.canvas_row(project_id)
        if row.revision != body.expected_revision:
            raise conflict(body.expected_revision, canvas_out(row))
        return await self._save(
            project_id, row, body, method="PUT", path=f"{PREFIX}/{project_id}/canvas"
        )

    async def apply_operations(self, project_id, body):
        row = await self.projects.canvas_row(project_id)
        current = canvas_out(row)
        key = dict(owner_user_id=self.owner, kind="visual", resource_id=project_id, body=body)
        saved = await replay(self.session, **key)
        if saved is not None:
            return VisualCanvasDocumentOut.model_validate(saved)
        if current.revision != body.expected_revision:
            raise conflict(body.expected_revision, current)
        try:
            return await self._save(
                project_id,
                row,
                transform(current, body),
                method="POST",
                path=f"{PREFIX}/{project_id}/canvas/operations",
                record_operation=lambda result: record(self.session, **key, result=result),
            )
        except RevisionConflictError:
            saved = await replay(self.session, **key)
            if saved is not None:
                return VisualCanvasDocumentOut.model_validate(saved)
            raise

    async def _save(self, project_id, row, body, *, method, path, record_operation=None):
        existing = existing_assets(row.nodes or [])
        used = {asset_id for asset_id, _ in expected_assets(body.nodes)}
        history = await self._history_assets(project_id, {node.id for node in body.nodes})
        carry = history | (existing & used)
        await self.session.rollback()
        prepared = await self._prepare(
            project_id,
            expected=body.expected_revision,
            method=method,
            path=path,
            files=used | history,
            used=sorted(used),
            carried=sorted(carry),
        )

        async def validate(_project_id, nodes, _current_nodes):
            descriptions = {value.id: value for value in prepared.metadata}
            for asset_id, kind in expected_assets(nodes):
                if asset_id in prepared.unavailable_asset_ids:
                    continue
                if descriptions[asset_id].media_kind != kind:
                    raise ProjectResourceError("节点与素材类型不匹配", "asset_kind_mismatch", 422)

        async def apply():
            return await CanvasDocuments(self.session, validate_assets=validate).replace(
                project_id, body
            )

        return await self.references.commit_source(self.session, prepared, apply, record_operation)
