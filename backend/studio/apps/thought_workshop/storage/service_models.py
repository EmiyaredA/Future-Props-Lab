"""Thought-owned tables; external IDs remain opaque in the independent schema."""

from studio.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtDocumentReference,
    ThoughtReadingState,
    ThoughtSavedFilter,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityFavorite,
    CommunityUpload,
    OfficialImportReceipt,
    OfficialSource,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.storage.archive_records import ThoughtArchiveImport
from studio.apps.thought_workshop.storage.community_upload_records import ThoughtCommunityUpload
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from studio.apps.thought_workshop.storage.retention_records import ThoughtReferenceMutation
from studio.apps.thought_workshop.storage.upload_records import ThoughtUploadIntent
from studio.runtime.database.project_operations import ProjectOperationReceipt

MODELS = (
    ThoughtArchiveImport,
    ThoughtCommunityUpload,
    ThoughtReferenceMutation,
    ThoughtUploadIntent,
    ArticleSyncBinding,
    ArticleSyncTask,
    ArticleSyncStep,
    ArticleSyncAsset,
    ThoughtDocumentReference,
    ThoughtTemplate,
    ThoughtTemplateAsset,
    ThoughtCheckpoint,
    ThoughtSavedFilter,
    ThoughtReadingState,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
    ThoughtHistoryAsset,
    DataTable,
    DataField,
    DataView,
    DataRecord,
    DataChange,
    DataAsset,
    Publication,
    PublishedArticle,
    ArticleMember,
    CommunityFavorite,
    CommunityUpload,
    OfficialSource,
    OfficialImportReceipt,
    ProjectOperationReceipt,
)

ACCOUNT_MODELS = tuple(model for model in MODELS if hasattr(model, "owner_user_id"))
