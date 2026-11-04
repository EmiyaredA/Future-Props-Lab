"""Assets-owned reference sets and idempotent transfer receipts."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.capabilities.asset_store.models import VisualAsset, VisualAssetFolder
from app.runtime.ids import new_id
from app.runtime.time import utc_now


class ReferenceBase(DeclarativeBase):
    pass


class AssetReferenceSet(ReferenceBase):
    __tablename__ = "asset_reference_sets"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "service_id", "resource_kind", "resource_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(64))
    resource_kind: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(128))
    resource_revision: Mapped[int] = mapped_column(Integer)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AssetReferencePin(ReferenceBase):
    __tablename__ = "asset_reference_pins"
    reference_set_id: Mapped[str] = mapped_column(
        ForeignKey("asset_reference_sets.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(VisualAsset.__table__.c.id, ondelete="RESTRICT"), primary_key=True, index=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)


class AssetReferenceReceipt(ReferenceBase):
    __tablename__ = "asset_reference_receipts"
    __table_args__ = (UniqueConstraint("owner_user_id", "service_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(128))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AssetDeletion(ReferenceBase):
    __tablename__ = "asset_file_deletions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    asset_snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ReferenceIntent(ReferenceBase):
    __tablename__ = "asset_reference_intents"
    __table_args__ = (UniqueConstraint("owner_user_id", "service_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(128))
    reference_set_id: Mapped[str] = mapped_column(ForeignKey("asset_reference_sets.id"))
    expected_resource_revision: Mapped[int] = mapped_column(Integer)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16), default="prepared", index=True)
    prepared_result: Mapped[dict] = mapped_column(JSON)
    committed_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    committed_deleted: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    committed_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    aborted_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class PreparedAssetPin(ReferenceBase):
    __tablename__ = "asset_prepared_pins"
    intent_id: Mapped[str] = mapped_column(
        ForeignKey("asset_reference_intents.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(VisualAsset.__table__.c.id, ondelete="RESTRICT"), primary_key=True, index=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)


class VisualProjectFileLink(ReferenceBase):
    """Library-file placement, not the source project's document or history."""

    __tablename__ = "asset_visual_project_links"
    __table_args__ = (UniqueConstraint("owner_user_id", "project_id", "asset_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(String(36))
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(VisualAsset.__table__.c.id, ondelete="RESTRICT"), index=True
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey(VisualAssetFolder.__table__.c.id, ondelete="CASCADE"), nullable=True
    )
    display_name: Mapped[str] = mapped_column(String(255))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelLibraryOutputReceipt(ReferenceBase):
    """A source result is copied once; response loss cannot duplicate library content."""

    __tablename__ = "asset_model_output_receipts"
    __table_args__ = (UniqueConstraint("owner_user_id", "source_task_id", "descriptor_sha256"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    source_task_id: Mapped[str] = mapped_column(String(128))
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    content_sha256: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtUploadReceipt(ReferenceBase):
    """A source request has one durable result, including after response loss."""

    __tablename__ = "asset_thought_upload_receipts"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(128))
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtArchiveBatch(ReferenceBase):
    """One archive's immutable source descriptor and publication decision."""

    __tablename__ = "asset_thought_archive_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    projections: Mapped[list | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtArchiveFile(ReferenceBase):
    """Validated file metadata while its bytes remain private to the batch."""

    __tablename__ = "asset_thought_archive_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_thought_archive_batches.owner_user_id",
                "asset_thought_archive_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class PresentationArchiveBatch(ReferenceBase):
    """One archive's immutable source descriptor and publication decision."""

    __tablename__ = "asset_presentation_archive_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    projections: Mapped[list | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PresentationArchiveFile(ReferenceBase):
    """Validated file metadata while its bytes remain private to the batch."""

    __tablename__ = "asset_presentation_archive_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_presentation_archive_batches.owner_user_id",
                "asset_presentation_archive_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class MotionFileWriteReceipt(ReferenceBase):
    __tablename__ = "asset_motion_file_write_receipts"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[list] = mapped_column(JSON)


class VideoFileWriteReceipt(ReferenceBase):
    __tablename__ = "asset_video_file_write_receipts"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[list] = mapped_column(JSON)


class GalgameUploadReceipt(ReferenceBase):
    __tablename__ = "asset_galgame_upload_receipts"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[list] = mapped_column(JSON)


class GalgameUploadStage(ReferenceBase):
    __tablename__ = "asset_galgame_upload_stages"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    storage_keys: Mapped[list] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="open")


class MotionArchiveBatch(ReferenceBase):
    """One archive's immutable source descriptor and publication decision."""

    __tablename__ = "asset_motion_archive_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    projections: Mapped[list | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class MotionArchiveFile(ReferenceBase):
    """Validated file metadata while its bytes remain private to the batch."""

    __tablename__ = "asset_motion_archive_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_motion_archive_batches.owner_user_id",
                "asset_motion_archive_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class VideoArchiveBatch(ReferenceBase):
    """One archive's immutable source descriptor and publication decision."""

    __tablename__ = "asset_video_archive_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    projections: Mapped[list | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VideoArchiveFile(ReferenceBase):
    """Validated file metadata while its bytes remain private to the batch."""

    __tablename__ = "asset_video_archive_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_video_archive_batches.owner_user_id",
                "asset_video_archive_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class GalgameArchiveBatch(ReferenceBase):
    """One archive's immutable source descriptor and publication decision."""

    __tablename__ = "asset_galgame_archive_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    projections: Mapped[list | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GalgameArchiveFile(ReferenceBase):
    """Validated file metadata while its bytes remain private to the batch."""

    __tablename__ = "asset_galgame_archive_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_galgame_archive_batches.owner_user_id",
                "asset_galgame_archive_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class VideoSegmentHandoffBatch(ReferenceBase):
    """Invisible library originals for an exact cross-service canvas handoff."""

    __tablename__ = "asset_video_segment_handoff_batches"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    scope: Mapped[dict] = mapped_column(JSON)
    manifest: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VideoSegmentHandoffFile(ReferenceBase):
    __tablename__ = "asset_video_segment_handoff_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_user_id", "batch_id"],
            [
                "asset_video_segment_handoff_batches.owner_user_id",
                "asset_video_segment_handoff_batches.batch_id",
            ],
            ondelete="RESTRICT",
        ),
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)


class VisualUploadStage(ReferenceBase):
    """Private originals admitted by one exclusive Canvas reference intent."""

    __tablename__ = "asset_visual_upload_stages"
    intent_id: Mapped[str] = mapped_column(
        ForeignKey("asset_reference_intents.id", ondelete="RESTRICT"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(String(128))
    descriptor: Mapped[dict] = mapped_column(JSON)
    storage_keys: Mapped[list] = mapped_column(JSON)
    originals: Mapped[list] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(16), default="reserved")


MODELS = (
    VisualUploadStage,
    VisualAssetFolder,
    VisualAsset,
    AssetReferenceSet,
    AssetReferencePin,
    AssetReferenceReceipt,
    AssetDeletion,
    ReferenceIntent,
    PreparedAssetPin,
    VisualProjectFileLink,
    ModelLibraryOutputReceipt,
    ThoughtUploadReceipt,
    ThoughtArchiveBatch,
    ThoughtArchiveFile,
    PresentationArchiveBatch,
    PresentationArchiveFile,
    MotionFileWriteReceipt,
    VideoFileWriteReceipt,
    GalgameUploadReceipt,
    GalgameUploadStage,
    MotionArchiveBatch,
    MotionArchiveFile,
    VideoArchiveBatch,
    VideoArchiveFile,
    GalgameArchiveBatch,
    GalgameArchiveFile,
    VideoSegmentHandoffBatch,
    VideoSegmentHandoffFile,
)
