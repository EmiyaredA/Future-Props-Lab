"""Freeze the exact owned node context before accepting a Visual review job."""

from copy import deepcopy
from uuid import uuid4

from sqlalchemy import func, select, text

from studio.apps.visual_workshop.acceptance.acceptance_context import AcceptanceContext
from studio.apps.visual_workshop.acceptance.context_values import fingerprint, resolve_context
from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRun,
    AcceptanceStandardVersion,
)
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError, project
from studio.apps.visual_workshop.acceptance.runs import Runs, run_out
from studio.apps.visual_workshop.acceptance.schemes import SCHEMES
from studio.apps.visual_workshop.reference_backlog import pending_outcomes
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.apps.visual_workshop.storage.review_dispatch_records import VisualReviewDispatch
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.visual_workshop.visual_samples import evidence_resource
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError


def context_changed():
    return AcceptanceError("验收依据已变化，请重新读取后验收", "context_changed", 409)


class BindingChanged(Exception):
    def __init__(self, revision):
        self.revision = revision


class ReplayedSubmission(Exception):
    def __init__(self, result):
        self.result = result


class ReviewSubmission:
    def __init__(self, request, session, principal, plan_executor):
        self.request, self.session = request, session
        self.state = request.app.state
        self.owner, self.user = principal.owner_user_id, principal.user_id
        self.assertion, self.source = request.state.service_assertion, request.url.path
        self.context = AcceptanceContext(request)
        self.nodes = self.context.nodes(session, principal)
        self.references = self.state.reference_mutations
        self.plan_executor = plan_executor

    async def prior(self, project_id, request_id, digest):
        prior = await self.session.scalar(
            select(AcceptanceRun)
            .where(AcceptanceRun.project_id == project_id, AcceptanceRun.request_id == request_id)
            .limit(1)
        )
        if prior is not None:
            if prior.fingerprint != digest:
                raise AcceptanceError("请求标识已用于其他验收", "request_conflict", 409)
            return run_out(prior)
        return None

    async def binding_conflict(self, project_id, node_id, body, revision):
        current = await self.nodes.get(project_id, node_id, body.output_id)
        return RevisionConflictError(
            body.expected_revision, revision, current.model_dump(mode="json")
        )

    async def start(self, project_id, node_id, body):
        db = self.session
        await project(db, self.owner, project_id)
        digest = fingerprint({"node_id": node_id, **body.model_dump()})
        prior = await self.prior(project_id, body.request_id, digest)
        if prior is not None:
            return prior
        binding = await self.nodes.binding(project_id, node_id)
        if not binding or binding.scheme_id not in SCHEMES:
            raise AcceptanceError("请先选择验收方案")
        if binding.revision != body.expected_revision:
            raise await self.binding_conflict(project_id, node_id, body, binding.revision)
        scheme = binding.scheme_id
        executor = await self.plan_executor(self.request, scheme)
        # A fresh read under the writer fence uses this same scoped Assets projection.
        # The write transaction never calls a peer.
        assets = {}

        async def load(ids):
            assets.update(await self.context.assets(project_id, ids))
            return assets

        async def cached(ids):
            return {identity: assets[identity] for identity in ids if identity in assets}

        canvas, _, _, inputs, _, issues, snapshot = await resolve_context(
            db, self.owner, project_id, node_id, scheme, body.output_id, load_assets=load
        )
        self.check_context(canvas, body, issues, snapshot)
        retained = sorted({item.asset_id for item in inputs})
        for receipt in await pending_outcomes(db, project_id):
            await self.state.reference_delivery.deliver(self.owner, receipt)

        run_id = new_id()
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="acceptance",
            resource_id=evidence_resource(run_id),
            expected_resource_revision=-1,
            asset_ids=retained,
            visual_review_project=project_id,
        )
        try:
            prepared = await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method="POST",
                source_path=self.source,
                change=change,
            )
        except BaseException as exc:
            await self.references.abandon_preparation(db, self.owner, change)
            if not isinstance(exc, (CapabilityDenied, CapabilityUnavailable)):
                raise
            if isinstance(exc, CapabilityDenied) and exc.status in (401, 403, 404):
                raise AcceptanceError(
                    "验收素材或授权不可用", "acceptance_inputs_denied", exc.status
                ) from exc
            raise AcceptanceError(
                "验收素材准备暂不可用", "acceptance_inputs_unavailable", 503
            ) from exc

        async def persist():
            await db.execute(text("BEGIN IMMEDIATE"))
            prior = await self.prior(project_id, body.request_id, digest)
            if prior is not None:
                raise ReplayedSubmission(prior)
            await project(db, self.owner, project_id)
            current = await self.nodes.binding(project_id, node_id)
            revision = current.revision if current else 0
            if revision != body.expected_revision:
                raise BindingChanged(revision)
            if current is None or current.scheme_id != scheme:
                raise context_changed()
            row = await db.get(VisualCanvasDocument, project_id)
            if row is None or row.revision != body.expected_canvas_revision:
                raise context_changed()
            canvas, _, output, _, _, issues, frozen = await resolve_context(
                db, self.owner, project_id, node_id, scheme, body.output_id, load_assets=cached
            )
            self.check_context(canvas, body, issues, frozen)
            if body.previous_run_id:
                previous = await Runs(db, self.owner).row(project_id, body.previous_run_id)
                if previous.node_id != node_id or previous.output_id == output.id:
                    raise AcceptanceError("复验应选择同一节点的另一个输出版本")
            return await self.persist(
                project_id,
                node_id,
                run_id,
                body,
                digest,
                scheme,
                executor,
                frozen,
                retained,
                prepared.request_id,
            )

        try:
            return await self.references.commit_source(db, prepared, persist)
        except ReplayedSubmission as exc:
            return exc.result
        except BindingChanged as exc:
            raise await self.binding_conflict(project_id, node_id, body, exc.revision) from exc

    @staticmethod
    def check_context(canvas, body, issues, snapshot):
        if (
            canvas.revision != body.expected_canvas_revision
            or snapshot["context_fingerprint"] != body.context_fingerprint
        ):
            raise context_changed()
        if issues:
            raise AcceptanceError("；".join(issues), "inputs_not_ready")

    async def persist(
        self,
        project_id,
        node_id,
        run_id,
        body,
        digest,
        scheme,
        executor,
        snapshot,
        retained,
        retention_receipt,
    ):
        db = self.session
        number = await db.scalar(
            select(func.max(AcceptanceStandardVersion.version)).where(
                AcceptanceStandardVersion.project_id == project_id
            )
        )
        definition = AcceptanceStandardVersion(
            id=new_id(),
            owner_user_id=self.owner,
            project_id=project_id,
            version=(number or 0) + 1,
            document={
                "title": "动作迁移",
                "node_ids": [node_id],
                "criteria": deepcopy(snapshot["criteria"]),
            },
        )
        db.add(definition)
        await db.flush()
        public_executor = executor["projection"]
        run = AcceptanceRun(
            id=run_id,
            owner_user_id=self.owner,
            project_id=project_id,
            node_id=node_id,
            output_id=body.output_id,
            standard_id=definition.id,
            previous_run_id=body.previous_run_id,
            request_id=body.request_id,
            fingerprint=digest,
            scheme_id=scheme,
            model_id=public_executor["model_id"],
            snapshot={
                **snapshot,
                "executor": {**public_executor, "scheme_id": scheme, "user_id": self.user},
            },
        )
        db.add(run)
        await db.flush()
        db.add(
            VisualReviewDispatch(
                run_id=run_id,
                owner_user_id=self.owner,
                assertion=self.assertion,
                source_path=self.source,
                executor=executor,
                retention_receipt=retention_receipt,
            )
        )
        db.add_all(
            AcceptanceAssetReference(owner_id=run_id, project_id=project_id, asset_id=identity)
            for identity in retained
        )
        await db.flush()
        return run_out(run)
