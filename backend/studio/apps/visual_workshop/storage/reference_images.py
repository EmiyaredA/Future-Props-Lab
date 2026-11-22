"""Short owner-bound CAS writes and durable content/request registration receipts."""

from hashlib import sha256

from sqlalchemy import select, text

from studio.apps.visual_workshop.canvas_values import canvas_out
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.schemas.creative_workflow import (
    CardData,
    ReferenceImageRegistered,
)
from studio.apps.visual_workshop.storage.creative_records import card_out
from studio.apps.visual_workshop.storage.models import VisualAssetCard
from studio.runtime.database.operation_receipts import record, replay
from studio.runtime.database.project_operations import ProjectOperationReceipt
from studio.runtime.ids import new_id
from studio.runtime.operation_errors import OperationError
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class SqlReferenceImages:
    def __init__(self, session, owner, guard=None):
        self.session, self.owner = session, owner
        self.guard = guard
        self.projects = Projects(session, owner)

    async def require_project(self, project):
        await self.projects.row(project)

    async def register(self, project, body, identity):
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            if self.guard is not None:
                await self.guard(self.session, self.owner, project)
            canvas = await self.projects.canvas_row(project)
            receipt_body = body.model_copy(
                update={
                    "expected_revision": 0,
                    "request_id": sha256(f"reference-image:{body.request_id}".encode()).hexdigest(),
                }
            )
            receipt_args = dict(owner_user_id=self.owner, kind="visual", resource_id=project)
            try:
                previous = await replay(self.session, **receipt_args, body=receipt_body)
            except OperationError as exc:
                raise ProjectResourceError(str(exc), exc.code, 409) from exc
            if previous:
                row = await self.session.get(VisualAssetCard, previous["card"]["id"])
                if (
                    row is None
                    or row.owner_user_id != self.owner
                    or row.id not in canvas.project_card_ids
                    or row.data.get("archived")
                ):
                    raise ProjectResourceError(
                        "已登记的卡片已从项目移除或归档，请重新选择", "reference_image_removed", 409
                    )
                result = ReferenceImageRegistered(
                    card=card_out(row),
                    project_card_ids=canvas.project_card_ids,
                    revision=canvas.revision,
                    reused=previous["reused"],
                )
                await self.session.rollback()
                return result
            if canvas.revision != body.expected_revision:
                raise RevisionConflictError(
                    body.expected_revision,
                    canvas.revision,
                    canvas_out(canvas).model_dump(mode="json"),
                )
            rows = list(
                await self.session.scalars(
                    select(VisualAssetCard).where(VisualAssetCard.owner_user_id == self.owner)
                )
            )
            known = {row.id: row for row in rows}
            ids = set(canvas.project_card_ids or [])
            equivalents = {body.asset_id, *identity.equivalent_ids}
            content_key = (
                self.owner,
                "visual",
                project,
                sha256(
                    f"reference-image-content:{body.kind}:{identity.content_key}".encode()
                ).hexdigest(),
            )
            pin = await self.session.get(ProjectOperationReceipt, content_key)
            pinned = known.get(pin.result.get("card_id")) if pin else None
            matches = [
                row
                for row in rows
                if row.id in ids
                and row.data.get("kind") == body.kind
                and not row.data.get("archived")
                and row.data.get("adopted_asset_id") in equivalents
            ]
            if (
                pinned
                and pinned.id in ids
                and pinned.data.get("kind") == body.kind
                and not pinned.data.get("archived")
                and pinned.data.get("adopted_asset_id") == pin.result.get("asset_id")
                and pinned not in matches
            ):
                matches.append(pinned)
            if body.reuse_card_id:
                chosen = next((row for row in matches if row.id == body.reuse_card_id), None)
                if chosen is None:
                    raise ProjectResourceError(
                        "所选卡片不属于项目或图片内容已变化", "reference_image_choice_invalid", 422
                    )
            elif len(matches) > 1:
                raise ProjectResourceError(
                    "项目中有多张同内容同类卡，请选择要关联的卡片",
                    "reference_image_choice_required",
                    409,
                )
            else:
                chosen = matches[0] if matches else None
            reused = chosen is not None
            if chosen is None:
                if len(rows) >= 500:
                    raise ProjectResourceError(
                        "设定库最多可创建 500 张设定卡", "visual_card_limit", 409
                    )
                data = CardData(kind=body.kind, title=body.title, adopted_asset_id=body.asset_id)
                chosen = VisualAssetCard(
                    id=new_id(),
                    owner_user_id=self.owner,
                    data=data.model_dump(),
                    media_projects={body.asset_id: project},
                    revision=0,
                )
                self.session.add(chosen)
                canvas.project_card_ids = [*(canvas.project_card_ids or []), chosen.id]
                canvas.revision += 1
                canvas.updated_at = utc_now()
            if pin is None:
                self.session.add(
                    ProjectOperationReceipt(
                        owner_user_id=self.owner,
                        resource_kind=content_key[1],
                        resource_id=project,
                        request_id=content_key[3],
                        fingerprint=identity.content_key,
                        result={
                            "card_id": chosen.id,
                            "asset_id": chosen.data.get("adopted_asset_id"),
                        },
                    )
                )
            else:
                pin.result = {"card_id": chosen.id, "asset_id": chosen.data.get("adopted_asset_id")}
            await self.session.flush()
            result = ReferenceImageRegistered(
                card=card_out(chosen),
                project_card_ids=canvas.project_card_ids,
                revision=canvas.revision,
                reused=reused,
            )
            record(self.session, **receipt_args, body=receipt_body, result=result)
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            raise
