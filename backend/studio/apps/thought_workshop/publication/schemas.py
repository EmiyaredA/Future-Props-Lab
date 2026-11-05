from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from studio.apps.thought_workshop.schemas.document import validate_document
from studio.apps.thought_workshop.schemas.knowledge import ThoughtDirectoryOut
from studio.apps.thought_workshop.schemas.workshop import (
    ThoughtNoteIn,
    ThoughtNoteOut,
    ThoughtNoteSummary,
)

Role = Literal["read", "edit", "manage"]
Visibility = Literal["public", "members"]
PlatformRole = Literal["admin", "admin", "user"]


class MemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    role: Role


class MemberOut(MemberInput):
    user_id: str
    display_name: str


class ArticleSetting(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note_id: str
    expected_revision: int = Field(ge=0)
    visibility: Visibility = "public"
    active: bool = True
    members: list[MemberInput] = Field(default_factory=list, max_length=100)


class PublishInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    active: bool = True
    is_official: bool = False
    read_only: bool = True
    editable_platform_roles: list[PlatformRole] = Field(default_factory=list, max_length=3)
    articles: list[ArticleSetting] = Field(max_length=2000)

    @model_validator(mode="after")
    def require_articles_when_active(self):
        if self.active and not self.articles:
            raise ValueError("开放发布需要选定文章")
        return self


class PermissionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    articles: list[ArticleSetting] = Field(min_length=1, max_length=2000)


class ArticleConfig(BaseModel):
    note_id: str
    title: str
    revision: int
    visibility: Visibility
    active: bool
    members: list[MemberOut]


class PublicationOut(BaseModel):
    id: str
    title: str
    description: str
    author: str
    document_count: int
    updated_at: datetime
    revision: int
    active: bool
    can_manage_library: bool
    is_official: bool = False
    read_only: bool = False
    editable_platform_roles: list[PlatformRole] = Field(default_factory=list)
    can_set_official: bool = False
    favorite: bool = False
    cover_url: str | None = None


class PublicationConfig(BaseModel):
    publication: PublicationOut | None
    articles: list[ArticleConfig]
    can_set_official: bool = False


class ArticleCapabilities(BaseModel):
    role: Role

    can_edit: bool = False
    can_manage: bool = False


class CommunityArticle(ThoughtNoteSummary, ArticleCapabilities):
    permission_revision: int


class CommunityDirectory(BaseModel):
    publication: PublicationOut
    documents: list[CommunityArticle]


class CommunityNote(ArticleCapabilities):
    note: ThoughtNoteOut
    permission_revision: int


class CommunityNotePut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=240)
    document: dict
    schema_version: Literal[2, 3] = 3
    tags: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("document")
    @classmethod
    def valid_document(cls, value):
        return validate_document(value)

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, value):
        return ThoughtNoteIn.valid_tags(value)

    @field_validator("title")
    @classmethod
    def valid_title(cls, value):
        return ThoughtNoteIn.valid_title(value)

    def validated(self, original):
        return ThoughtNoteIn(
            kind=original.kind,
            title=self.title,
            document=self.document,
            schema_version=self.schema_version,
            tags=self.tags,
            knowledge_base_id=original.knowledge_base_id,
            parent_id=original.parent_id,
            pinned=original.pinned,
            favorite=original.favorite,
        )


class FavoriteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    favorite: bool


class FavoritesOut(BaseModel):
    resource_ids: list[str]


class CommunitySnapshot(BaseModel):
    knowledge_base: PublicationOut
    documents: list[ThoughtNoteOut]
    asset_ids: list[str]


class CommunityManagement(BaseModel):
    directory: ThoughtDirectoryOut
    config: PublicationConfig
