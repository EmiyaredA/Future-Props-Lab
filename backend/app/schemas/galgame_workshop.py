from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GalgameWorkshopProjectStatus = Literal["draft", "completed"]
STABLE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"


def _clean_title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("名称不能为空")
    return cleaned


class GalgameWorkshopProjectOut(BaseModel):
    id: str
    title: str
    status: GalgameWorkshopProjectStatus
    revision: int
    created_at: str
    updated_at: str


class GalgameWorkshopProjectListOut(BaseModel):
    items: list[GalgameWorkshopProjectOut]


class GalgameWorkshopProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameWorkshopProjectPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: GalgameWorkshopProjectStatus | None = None

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> GalgameWorkshopProjectPatchIn:
        if self.title is None and self.status is None:
            raise ValueError("至少需要提供一个修改字段")
        return self


class GalgameStoryModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class GalgameStoryCharacterExpression(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryCharacter(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    expressions: list[GalgameStoryCharacterExpression] = Field(default_factory=list, max_length=100)
    default_expression_id: str | None = Field(
        default=None, alias="defaultExpressionId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def expressions_are_valid(self) -> GalgameStoryCharacter:
        expression_ids = [expression.id for expression in self.expressions]
        if len(expression_ids) != len(set(expression_ids)):
            raise ValueError("同一角色的表情 ID 不能重复")
        if self.default_expression_id is not None:
            if self.default_expression_id not in set(expression_ids):
                raise ValueError("角色默认表情不存在")
        elif self.expressions:
            raise ValueError("存在立绘表情时必须指定默认表情")
        return self


class GalgameStoryAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["image"]
    role: Literal["characterPortrait", "sceneBackground"]
    file_id: str = Field(alias="fileId", min_length=1, max_length=36)
    status: Literal["ready"]


class GalgameStorySceneBackground(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryScene(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    backgrounds: list[GalgameStorySceneBackground] = Field(default_factory=list, max_length=100)
    default_background_id: str | None = Field(
        default=None, alias="defaultBackgroundId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def backgrounds_are_valid(self) -> GalgameStoryScene:
        background_ids = [background.id for background in self.backgrounds]
        if len(background_ids) != len(set(background_ids)):
            raise ValueError("同一场景的背景 ID 不能重复")
        if self.default_background_id is not None:
            if self.default_background_id not in set(background_ids):
                raise ValueError("场景默认背景不存在")
        elif self.backgrounds:
            raise ValueError("存在背景状态时必须指定默认背景")
        return self


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)


class GalgameStorySceneBlock(GalgameStoryBlockBase):
    type: Literal["scene"]
    scene_id: str = Field(alias="sceneId", pattern=STABLE_ID_PATTERN)
    background_id: str | None = Field(default=None, alias="backgroundId", pattern=STABLE_ID_PATTERN)


class GalgameStoryNarrationBlock(GalgameStoryBlockBase):
    type: Literal["narration"]
    text: str = Field(default="", max_length=20_000)


class GalgameStoryDialogueBlock(GalgameStoryBlockBase):
    type: Literal["dialogue"]
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    text: str = Field(default="", max_length=20_000)


class GalgameStoryBranchChoice(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    text: str = Field(default="", max_length=1000)
    target_fragment_id: str = Field(alias="targetFragmentId", pattern=STABLE_ID_PATTERN)


class GalgameStoryBranchBlock(GalgameStoryBlockBase):
    type: Literal["branch"]
    prompt: str = Field(default="", max_length=2000)
    choices: list[GalgameStoryBranchChoice] = Field(min_length=2, max_length=12)

    @field_validator("choices")
    @classmethod
    def choice_ids_are_unique(
        cls, choices: list[GalgameStoryBranchChoice]
    ) -> list[GalgameStoryBranchChoice]:
        ids = [choice.id for choice in choices]
        if len(ids) != len(set(ids)):
            raise ValueError("同一分支的选项 ID 不能重复")
        return choices


class GalgameStoryEndChapterBlock(GalgameStoryBlockBase):
    type: Literal["endChapter"]
    ending_id: str = Field(alias="endingId", pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


GalgameStoryBlock = Annotated[
    GalgameStorySceneBlock
    | GalgameStoryNarrationBlock
    | GalgameStoryDialogueBlock
    | GalgameStoryBranchBlock
    | GalgameStoryEndChapterBlock,
    Field(discriminator="type"),
]


class GalgameStoryFragment(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    blocks: list[GalgameStoryBlock] = Field(default_factory=list, max_length=1000)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryChapter(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1, le=1000)
    entry_fragment_id: str = Field(alias="entryFragmentId", pattern=STABLE_ID_PATTERN)
    fragments: list[GalgameStoryFragment] = Field(default_factory=list, max_length=500)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryProject(GalgameStoryModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    synopsis: str = Field(default="", max_length=10_000)
    characters: list[GalgameStoryCharacter] = Field(default_factory=list, max_length=200)
    scenes: list[GalgameStoryScene] = Field(default_factory=list, max_length=200)
    variables: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    assets: list[GalgameStoryAsset] = Field(default_factory=list, max_length=2000)
    chapters: list[GalgameStoryChapter] = Field(default_factory=list, min_length=1, max_length=100)

    @model_validator(mode="after")
    def references_and_ids_are_valid(self) -> GalgameStoryProject:
        character_ids = [character.id for character in self.characters]
        scene_ids = [scene.id for scene in self.scenes]
        chapter_ids = [chapter.id for chapter in self.chapters]
        asset_ids = [asset.id for asset in self.assets]
        if len(character_ids) != len(set(character_ids)):
            raise ValueError("角色 ID 不能重复")
        if len(scene_ids) != len(set(scene_ids)):
            raise ValueError("场景 ID 不能重复")
        if len(chapter_ids) != len(set(chapter_ids)):
            raise ValueError("章节 ID 不能重复")
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("素材 ID 不能重复")

        known_characters = set(character_ids)
        known_scenes = set(scene_ids)
        assets_by_id = {asset.id: asset for asset in self.assets}
        expressions_by_character: dict[str, set[str]] = {}
        for character in self.characters:
            expressions_by_character[character.id] = {
                expression.id for expression in character.expressions
            }
            for expression in character.expressions:
                asset = assets_by_id.get(expression.asset_id)
                if asset is None:
                    raise ValueError("角色表情引用了不存在的立绘素材")
                if asset.role != "characterPortrait":
                    raise ValueError("角色表情只能引用角色立绘素材")
        backgrounds_by_scene: dict[str, set[str]] = {}
        for scene in self.scenes:
            backgrounds_by_scene[scene.id] = {background.id for background in scene.backgrounds}
            for background in scene.backgrounds:
                asset = assets_by_id.get(background.asset_id)
                if asset is None:
                    raise ValueError("场景背景引用了不存在的背景素材")
                if asset.role != "sceneBackground":
                    raise ValueError("场景背景只能引用场景背景素材")
        block_ids: list[str] = []
        ending_ids: list[str] = []
        for chapter in self.chapters:
            fragment_ids = [fragment.id for fragment in chapter.fragments]
            if len(fragment_ids) != len(set(fragment_ids)):
                raise ValueError(f"章节“{chapter.title}”的 Fragment ID 不能重复")
            known_fragments = set(fragment_ids)
            if chapter.entry_fragment_id not in known_fragments:
                raise ValueError(f"章节“{chapter.title}”的入口 Fragment 不存在")
            for fragment in chapter.fragments:
                for block in fragment.blocks:
                    block_ids.append(block.id)
                    if isinstance(block, GalgameStoryDialogueBlock):
                        if block.character_id not in known_characters:
                            raise ValueError("对白引用了不存在的角色")
                        if (
                            block.expression_id is not None
                            and block.expression_id
                            not in expressions_by_character[block.character_id]
                        ):
                            raise ValueError("对白引用了不属于当前角色的表情")
                    elif isinstance(block, GalgameStorySceneBlock):
                        if block.scene_id not in known_scenes:
                            raise ValueError("场景 Block 引用了不存在的场景")
                        if (
                            block.background_id is not None
                            and block.background_id not in backgrounds_by_scene[block.scene_id]
                        ):
                            raise ValueError("场景 Block 引用了不属于当前场景的背景")
                    elif isinstance(block, GalgameStoryBranchBlock):
                        if any(
                            choice.target_fragment_id not in known_fragments
                            for choice in block.choices
                        ):
                            raise ValueError("分支选项引用了当前章节外的 Fragment")
                    elif isinstance(block, GalgameStoryEndChapterBlock):
                        ending_ids.append(block.ending_id)
        if len(block_ids) != len(set(block_ids)):
            raise ValueError("Block ID 必须在整个工程内唯一")
        if len(ending_ids) != len(set(ending_ids)):
            raise ValueError("结局 ID 必须在整个工程内唯一")
        return self


class GalgameStoryDocumentPutIn(GalgameStoryModel):
    expected_revision: int = Field(ge=0)
    document: GalgameStoryProject


class GalgameStoryDocumentOut(BaseModel):
    project_id: str
    document: GalgameStoryProject
    revision: int
    updated_at: str


class GalgameProjectAssetOut(BaseModel):
    id: str
    display_name: str
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str


class GalgameProjectAssetListOut(BaseModel):
    items: list[GalgameProjectAssetOut]


class GalgameStoryReportIssue(BaseModel):
    code: str
    message: str
    path: str
    chapter_id: str | None = None
    fragment_id: str | None = None
    block_id: str | None = None


class GalgameStoryChapterReport(BaseModel):
    chapter_id: str
    reachable_fragment_ids: list[str]
    unreachable_fragment_ids: list[str]
    ending_ids: list[str]
    cycles: list[list[str]]


class GalgameStoryRouteReportOut(BaseModel):
    project_id: str
    story_revision: int
    ready: bool
    errors: list[GalgameStoryReportIssue]
    warnings: list[GalgameStoryReportIssue]
    chapters: list[GalgameStoryChapterReport]
