"""Apply rendered evidence only to the exact owned review revision."""

from copy import deepcopy
from uuid import uuid4

import httpx
from sqlalchemy import select, text

from app.apps.visual_workshop.acceptance.models import AcceptanceAssetReference
from app.apps.visual_workshop.acceptance.project_access import AcceptanceError
from app.apps.visual_workshop.acceptance.record_revisions import cas
from app.apps.visual_workshop.acceptance.runs import Runs, run_out
from app.apps.visual_workshop.acceptance.sample_values import positions
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.visual_samples import evidence_resource

from .models import VisualCanvasReferenceMutation
from .reference_backlog import pending_outcomes
from .review_media import ReviewMedia, evidence_manifest, stage_evidence, unavailable


class AcceptanceSamples:
    def __init__(self, request, session, owner):
        self.session, self.owner = session, owner
        self.runs = Runs(session, owner)
        self.state = request.app.state
        self.source, self.assertion = request.url.path, request.state.service_assertion
        self.media = ReviewMedia(self.state.capabilities, self.assertion, self.source)
        self.references = self.state.reference_mutations
        self.delivery = self.state.reference_delivery

    @staticmethod
    def validate(row, body):
        if row.scheme_id == "legacy" or row.decision == "historical":
            raise AcceptanceError(
                "历史验收记录只读，请选择内置方案重新验收", "historical_readonly", 409
            )
        if row.status != "completed" or row.snapshot["output"]["kind"] != "video":
            raise AcceptanceError("仅已完成的视频验收支持区间取样")
        duration = row.snapshot.get("metadata", {}).get("duration_ms", 0)
        if body.end_ms > duration:
            raise AcceptanceError("取样区间超出时长")
        if len(row.evidence) > 60:
            raise AcceptanceError("取样证据已达上限，请新建验收记录")
        if row.revision != body.expected_revision:
            current = run_out(row)
            raise RevisionConflictError(
                body.expected_revision, row.revision, current.model_dump(mode="json")
            )
        return duration

    async def sample(self, project, run_id, body):
        row = await self.runs.row(project, run_id)
        duration = self.validate(row, body)
        source_id = row.snapshot["output"]["asset_id"]
        if not source_id:
            raise AcceptanceError("验收源视频不存在", "not_found", 404)
        retained = set(
            await self.session.scalars(
                select(AcceptanceAssetReference.asset_id).where(
                    AcceptanceAssetReference.project_id == project,
                    AcceptanceAssetReference.owner_id == run_id,
                )
            )
        )
        retained.add(source_id)
        record = VisualCanvasReferenceMutation
        resource = evidence_resource(run_id)
        prior = await self.session.scalar(
            select(record.request_id)
            .where(
                record.state.in_(("commit", "delivered")),
                record.change["resource_kind"].as_string() == "acceptance",
                record.change["resource_id"].as_string() == resource,
            )
            .limit(1)
        )
        for identity in await pending_outcomes(self.session, project):
            await self.deliver(identity)
        try:
            async with self.media.render(
                project,
                run_id,
                source_id,
                positions_ms=positions(duration, body.start_ms, body.end_ms),
            ) as response:
                return await self.commit(
                    response,
                    project,
                    run_id,
                    body,
                    source_id,
                    resource,
                    body.expected_revision if prior else -1,
                    retained,
                )
        except (CapabilityUnavailable, httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise unavailable() from exc

    async def commit(
        self, response, project, run_id, body, source_id, resource, revision, retained
    ):
        media, length = evidence_manifest(response, project, source_id)
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="acceptance",
            resource_id=resource,
            expected_resource_revision=revision,
            asset_ids=sorted(retained),
            visual_evidence=media,
        )
        try:
            prepared = await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method="POST",
                source_path=self.source,
                change=change,
            )
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            await self.references.abandon_preparation(self.session, self.owner, change)
            if isinstance(exc, CapabilityDenied) and exc.status == 409:
                current = await self.runs.get(project, run_id)
                if current.revision != body.expected_revision:
                    raise RevisionConflictError(
                        body.expected_revision, current.revision, current.model_dump(mode="json")
                    ) from exc
            raise unavailable() from exc
        try:
            assets = await stage_evidence(self.references.client, prepared, response, length, media)
        except BaseException:
            await self.references.abort_after_rollback(self.session, prepared)
            raise

        async def apply():
            await self.session.execute(text("BEGIN IMMEDIATE"))
            run = await self.runs.row(project, run_id)
            self.validate(run, body)
            await cas(
                self.session, run, body.expected_revision, lambda: self.runs.get(project, run_id)
            )
            evidence = deepcopy(run.evidence)
            for frame, asset in zip(media.frames, assets, strict=True):
                evidence.append(
                    {
                        "id": new_id(),
                        "asset_id": asset.id,
                        "source_asset_id": source_id,
                        "position_ms": frame.position_ms,
                    }
                )
                self.session.add(
                    AcceptanceAssetReference(owner_id=run_id, project_id=project, asset_id=asset.id)
                )
            run.evidence, run.decision = evidence, "pending"
            return run_out(run)

        result = await self.references.commit_source(self.session, prepared, apply)
        await self.deliver(prepared.request_id)
        return result

    async def deliver(self, identity):
        try:
            await self.delivery.deliver(self.owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise unavailable() from exc
