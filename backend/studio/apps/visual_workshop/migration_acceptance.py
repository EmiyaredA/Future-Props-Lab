"""Keep historical Visual review definitions, results and repair records."""

from datetime import datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import func, select

from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
)
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

REFERENCE_CURSOR = r"^[A-F0-9]{2,256}_[A-F0-9]{2,256}$"


class TemplateRecord(HistoryRecord):
    id: Identifier
    title: str = Field(min_length=1, max_length=120)
    document: dict
    revision: int = Field(ge=0, strict=True)
    created_at: datetime


class StandardRecord(HistoryRecord):
    project_id: Identifier
    draft: dict
    published_version: int = Field(ge=0, strict=True)
    required: bool
    revision: int = Field(ge=0, strict=True)


class VersionRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    version: int = Field(ge=1, strict=True)
    document: dict
    created_at: datetime


class RunRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    node_id: str = Field(min_length=1, max_length=64)
    output_id: Identifier
    standard_id: Identifier
    previous_run_id: Identifier | None
    request_id: str = Field(min_length=1, max_length=100)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    model_id: Identifier | None
    scheme_id: str = Field(min_length=1, max_length=64)
    execution_result: dict
    status: Literal["queued", "processing", "completed", "failed", "cancelled"]
    decision: Literal["pending", "passed", "failed", "historical"]
    snapshot: dict
    results: list[dict]
    evidence: list[dict]
    decisions: list[dict]
    error_message: str | None
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime


class BindingRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    node_id: str = Field(min_length=1, max_length=64)
    scheme_id: str | None = Field(max_length=64)
    revision: int = Field(ge=0, strict=True)


class RepairRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    run_id: Identifier
    text: str
    revision: int = Field(ge=0, strict=True)
    prompt_version_id: Identifier | None


class ReferenceRecord(HistoryRecord):
    owner_id: Identifier
    asset_id: Identifier
    project_id: Identifier

    @property
    def cursor(self):
        return self.owner_id.encode().hex().upper() + "_" + self.asset_id.encode().hex().upper()


class Templates(MigrationBatch[TemplateRecord]):
    dataset: Literal["visual.acceptance-templates"]


class Standards(MigrationBatch[StandardRecord]):
    dataset: Literal["visual.acceptance-standards"]


class Versions(MigrationBatch[VersionRecord]):
    dataset: Literal["visual.acceptance-versions"]


class Runs(MigrationBatch[RunRecord]):
    dataset: Literal["visual.acceptance-runs"]


class Bindings(MigrationBatch[BindingRecord]):
    dataset: Literal["visual.acceptance-bindings"]


class Repairs(MigrationBatch[RepairRecord]):
    dataset: Literal["visual.acceptance-repair-drafts"]


class References(MigrationBatch[ReferenceRecord]):
    dataset: Literal["visual.acceptance-asset-references"]


class ReferenceDataset(ProjectDataset):
    def key_for(self, value):
        if isinstance(value, ReferenceRecord):
            return value.cursor
        return func.hex(value.owner_id) + "_" + func.hex(value.asset_id)


async def owned_record(session, model, identity, project):
    return await session.scalar(
        select(model).where(
            model.id == identity,
            model.project_id == project,
            model.owner_user_id == session.info["owner_user_id"],
        )
    )


async def validate_run(session, record):
    output = await session.get(VisualNodeOutput, record.output_id)
    if output is None or output.project_id != record.project_id or output.node_id != record.node_id:
        raise blocked("migration_visual_acceptance_output_conflict")
    version = await owned_record(
        session, AcceptanceStandardVersion, record.standard_id, record.project_id
    )
    if version is None:
        raise blocked("migration_visual_acceptance_standard_conflict")


async def validate_repair(session, record):
    if await owned_record(session, AcceptanceRun, record.run_id, record.project_id) is None:
        raise blocked("migration_visual_acceptance_run_conflict")


async def validate_reference(session, record):
    owners = (
        await owned_record(session, AcceptanceRun, record.owner_id, record.project_id),
        await owned_record(session, AcceptanceStandardVersion, record.owner_id, record.project_id),
    )
    if sum(item is not None for item in owners) != 1:
        raise blocked("migration_visual_acceptance_reference_conflict")


DATASETS = (
    ProjectDataset(
        "visual.acceptance-templates",
        AcceptanceTemplate,
        TemplateRecord,
        Templates,
        MigrationPage[Templates],
    ),
    ProjectDataset(
        "visual.acceptance-standards",
        AcceptanceStandard,
        StandardRecord,
        Standards,
        MigrationPage[Standards],
        project=VisualWorkshopProject,
        key="project_id",
    ),
    ProjectDataset(
        "visual.acceptance-versions",
        AcceptanceStandardVersion,
        VersionRecord,
        Versions,
        MigrationPage[Versions],
        project=VisualWorkshopProject,
    ),
    ProjectDataset(
        "visual.acceptance-runs",
        AcceptanceRun,
        RunRecord,
        Runs,
        MigrationPage[Runs],
        project=VisualWorkshopProject,
        validate=validate_run,
    ),
    ProjectDataset(
        "visual.acceptance-bindings",
        NodeAcceptanceBinding,
        BindingRecord,
        Bindings,
        MigrationPage[Bindings],
        project=VisualWorkshopProject,
    ),
    ProjectDataset(
        "visual.acceptance-repair-drafts",
        AcceptanceRepairDraft,
        RepairRecord,
        Repairs,
        MigrationPage[Repairs],
        project=VisualWorkshopProject,
        validate=validate_repair,
    ),
    ReferenceDataset(
        "visual.acceptance-asset-references",
        AcceptanceAssetReference,
        ReferenceRecord,
        References,
        MigrationPage[References],
        project=VisualWorkshopProject,
        owns_record=False,
        key="cursor",
        cursor_pattern=REFERENCE_CURSOR,
        validate=validate_reference,
    ),
)
