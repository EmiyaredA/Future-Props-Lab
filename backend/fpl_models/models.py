"""Independent Models account configuration; external account IDs have no database FK."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

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
from app.runtime.time import utc_now


class ModelsBase(DeclarativeBase):
    pass


class AccountDefaults(ModelsBase):
    __tablename__ = "model_account_defaults"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    model_ids: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


MODELS = (
    AccountDefaults,
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

ACCOUNT_MODELS = tuple(model for model in MODELS if hasattr(model, "owner_user_id"))
