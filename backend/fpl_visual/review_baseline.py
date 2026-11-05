"""Checkpoint decoded review evidence together with the exact Assets source receipt."""

import json
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select, text

from app.apps.visual_workshop.acceptance.models import AcceptanceAssetReference, AcceptanceRun
from app.apps.visual_workshop.acceptance.project_access import AcceptanceError
from app.apps.visual_workshop.acceptance.runs import run_out
from app.apps.visual_workshop.acceptance.sample_values import check_specifications
from app.runtime.ids import new_id
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.visual_samples import MEDIA_HEADER, evidence_resource

from .review_dispatch_records import VisualReviewDispatch
from .review_media import ReviewMedia, evidence_manifest, stage_evidence


class ReviewChanged(Exception):
    """The run was cancelled or otherwise changed while executing outside its transaction."""


class ReviewBaseline:
    def __init__(self, state, db, dispatch, project_id):
        self.db, self.project_id = db, project_id
        self.owner, self.run_id = dispatch.owner_user_id, dispatch.run_id
        self.assertion, self.source = dispatch.assertion, dispatch.source_path
        self.media = ReviewMedia(state.capabilities, self.assertion, self.source)
        self.references, self.delivery = state.reference_mutations, state.reference_delivery

    async def locked_run(self, revision):
        await self.db.execute(text("BEGIN IMMEDIATE"))
        row = await self.db.get(AcceptanceRun, self.run_id, populate_existing=True)
        if row is None or row.status != "processing" or row.revision != revision:
            await self.db.rollback()
            raise ReviewChanged
        return row

    async def prepare(self, run):
        output = run.snapshot.output.asset_id
        if not run.snapshot.metadata:
            run = await self.sample(run, output, "review-output")
        references = {
            identity
            for criterion in run.snapshot.criteria
            for identity in criterion.reference_asset_ids
        }
        sampled = {row.source_asset_id for row in run.evidence}
        inputs = {item["asset_id"]: item["kind"] for item in run.snapshot.inputs["assets"]}
        for identity in sorted(references - sampled):
            if inputs[identity] == "video":
                run = await self.sample(run, identity, "review-reference")
            else:
                run = await self.record_image(run, identity)
        return run

    async def record_image(self, run, identity):
        row = await self.locked_run(run.revision)
        row.evidence = [
            *row.evidence,
            {
                "id": "ref-" + identity,
                "asset_id": identity,
                "source_asset_id": identity,
                "position_ms": None,
            },
        ]
        row.revision += 1
        result = run_out(row)
        await self.db.commit()
        return result

    async def sample(self, run, identity, mode):
        async with self.media.render(self.project_id, run.id, identity, mode=mode) as response:
            return await self.publish_frames(run, identity, response, mode=mode)

    async def publish_frames(self, run, identity, response, *, mode=None, native_frame=None):
        project_id = self.project_id
        retained = sorted(
            await self.db.scalars(
                select(AcceptanceAssetReference.asset_id).where(
                    AcceptanceAssetReference.owner_id == self.run_id
                )
            )
        )
        await self.db.rollback()
        media, length = evidence_manifest(response, project_id, identity)
        info = json.loads(response.headers[MEDIA_HEADER]) if mode == "review-output" else {}
        if native_frame is not None and (
            len(media.frames) != 1
            or media.frames[0].content_sha256 != native_frame.sha256
            or media.frames[0].byte_size != native_frame.byte_size
            or media.frames[0].position_ms != native_frame.position_ms
        ):
            raise ValueError("原生追加帧回执与证据流不一致")
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="acceptance",
            resource_id=evidence_resource(run.id),
            expected_resource_revision=run.revision,
            asset_ids=retained,
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
        except BaseException:
            await self.references.abandon_preparation(self.db, self.owner, change)
            raise
        try:
            assets = await stage_evidence(self.references.client, prepared, response, length, media)
        except BaseException:
            await self.references.abort_after_rollback(self.db, prepared)
            raise

        async def apply():
            row = await self.locked_run(run.revision)
            dispatch = await self.db.get(VisualReviewDispatch, self.run_id, populate_existing=True)
            if dispatch is None:
                raise ReviewChanged
            evidence = []
            for frame, asset in zip(media.frames, assets, strict=True):
                self.db.add(
                    AcceptanceAssetReference(
                        owner_id=run.id, project_id=project_id, asset_id=asset.id
                    )
                )
                evidence.append(
                    {
                        "id": native_frame.id if native_frame is not None else new_id(),
                        "asset_id": asset.id,
                        "source_asset_id": identity,
                        "position_ms": frame.position_ms,
                    }
                )
            row.evidence = [*row.evidence, *evidence]
            if mode == "review-output":
                if not all(info.get(field, 0) > 0 for field in ("width", "height", "duration_ms")):
                    raise AcceptanceError("视频元数据无法读取")
                results = initial_results(info, row.snapshot["criteria"])
                row.results = results
                row.snapshot = {
                    **row.snapshot,
                    "metadata": info,
                    "check_results": deepcopy(results),
                }
            row.revision += 1
            dispatch.retention_receipt = prepared.request_id
            return run_out(row)

        result = await self.references.commit_source(self.db, prepared, apply)
        await self.delivery.deliver(self.owner, prepared.request_id)
        return result


def initial_results(info, criteria):
    rows = []
    for criterion in criteria:
        method = criterion["method"]
        verdict, explanation = (
            check_specifications(info, criterion["specifications"])
            if method == "automatic"
            else ("pending", "等待人工确认" if method == "manual" else "等待 AI 建议")
        )
        rows.append(
            {
                "criterion_id": criterion["id"],
                "verdict": verdict,
                "origin": method,
                "explanation": explanation,
                "evidence_ids": [],
            }
        )
    return rows
