"""Thought-owned tables; external IDs remain opaque in the independent schema."""

from app.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from app.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtDocumentReference,
    ThoughtReadingState,
    ThoughtSavedFilter,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from app.apps.thought_workshop.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from app.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from app.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityFavorite,
    CommunityUpload,
    OfficialImportReceipt,
    OfficialSource,
    Publication,
    PublishedArticle,
)
from app.runtime.project_operations import (
    ProjectOperationReceipt,
)

MODELS = (
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
