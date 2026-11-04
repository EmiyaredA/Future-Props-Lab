"""Independent Models account configuration; external account IDs have no database FK."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.llm.models import (
    LlmCallLog,
    LocalModelInstallation,
    LocalModelOperation,
    ModelCatalogState,
    ModelEntry,
    ModelInferenceAsset,
    ModelInferenceTask,
    ModelProvider,
    ModelSupplier,
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestMessage,
    ModelTestTranscriptionTask,
    RuntimeAdmission,
)
from app.runtime.ids import new_id
from app.runtime.time import utc_now

from .demo_install_records import DemoInstallation
from .integration_records import IntegrationCapacity
from .native_records import NATIVE_MODELS
from .orm import ModelsBase


class AccountDefaults(ModelsBase):
    __tablename__ = "model_account_defaults"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    model_ids: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class CatalogProvisioningReceipt(ModelsBase):
    __tablename__ = "model_catalog_provisioning"
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), unique=True)
    event_revision: Mapped[int] = mapped_column(Integer)
    event_digest: Mapped[str] = mapped_column(String(64))
    initialization_role: Mapped[str] = mapped_column(String(16))
    account_revision: Mapped[int] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RoleTemplate(ModelsBase):
    __tablename__ = "model_role_templates"
    __table_args__ = (CheckConstraint("role IN ('admin', 'user')"),)
    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class QuotaPolicy(ModelsBase):
    __tablename__ = "model_quota_policy"
    __table_args__ = (CheckConstraint("id = 'runtime'"),)
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="runtime")
    payload: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class TaskAuthorization(ModelsBase):
    __tablename__ = "model_task_authorizations"
    __table_args__ = (CheckConstraint("kind IN ('inference', 'model', 'transcription')"),)
    kind: Mapped[str] = mapped_column(String(24), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    source_method: Mapped[str] = mapped_column(String(12))
    source_path: Mapped[str] = mapped_column(String(4096))
    assertion: Mapped[str] = mapped_column(String(8192))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DemoSetting(ModelsBase):
    __tablename__ = "model_demo_settings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GovernanceAudit(ModelsBase):
    __tablename__ = "model_governance_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_user_id: Mapped[str] = mapped_column(String(36))
    event_type: Mapped[str] = mapped_column(String(100))
    detail: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    source_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    parent_intent_id: Mapped[str] = mapped_column(String(36), default="")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TemplateSyncAuthority(ModelsBase):
    __tablename__ = "model_template_sync_authority"
    job_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_path: Mapped[str] = mapped_column(String(4096))
    assertion: Mapped[str] = mapped_column(String(8192))
    audit_intent_id: Mapped[str] = mapped_column(String(36), default="")


class AnnotationTranscriptionAttempt(ModelsBase):
    __tablename__ = "model_annotation_transcription_attempts"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    attempt_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GalgameTranscriptionAttempt(ModelsBase):
    __tablename__ = "model_galgame_transcription_attempts"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="running", index=True)
    outcome: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


MODELS = (
    AnnotationTranscriptionAttempt,
    GalgameTranscriptionAttempt,
    *NATIVE_MODELS,
    DemoInstallation,
    IntegrationCapacity,
    DemoSetting,
    GovernanceAudit,
    TemplateSyncAuthority,
    AccountDefaults,
    CatalogProvisioningReceipt,
    RoleTemplate,
    QuotaPolicy,
    TaskAuthorization,
    LlmCallLog,
    LocalModelInstallation,
    LocalModelOperation,
    ModelCatalogState,
    ModelEntry,
    ModelInferenceAsset,
    ModelInferenceTask,
    ModelProvider,
    ModelSupplier,
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestMessage,
    ModelTestTranscriptionTask,
    RuntimeAdmission,
)

# TemplateSyncItem is a platform operation receipt; owner_user_id identifies
# its target, not ownership of private catalogue contents. Only admin use cases
# access these records; each catalogue read/write still binds its actual owner.
ACCOUNT_MODELS = tuple(
    model
    for model in MODELS
    if hasattr(model, "owner_user_id") and model is not ModelTemplateSyncItem
)
