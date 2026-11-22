"""Script and account-card values, independent of persistence and transport."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Identifier = Annotated[
    str, StringConstraints(pattern=r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
LongText = Annotated[str, StringConstraints(max_length=12_000)]


class WorkflowModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScriptScene(WorkflowModel):
    id: Identifier
    title: Title
    heading: Annotated[str, StringConstraints(max_length=240)] = ""
    text: LongText = ""


class ScriptEpisode(WorkflowModel):
    id: Identifier
    title: Title
    scenes: list[ScriptScene] = Field(default_factory=list, max_length=200)


class ScriptDocument(WorkflowModel):
    episodes: list[ScriptEpisode] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_document(self):
        ids = [episode.id for episode in self.episodes]
        scenes = [scene for episode in self.episodes for scene in episode.scenes]
        ids.extend(scene.id for scene in scenes)
        if len(ids) != len(set(ids)):
            raise ValueError("集与场的标识不能重复")
        if len(self.model_dump_json().encode()) > 2 * 1024 * 1024:
            raise ValueError("剧本文档不能超过 2 MiB")
        return self


class ScriptUpdate(ScriptDocument):
    expected_revision: int = Field(ge=0)


class ScriptOut(ScriptDocument):
    revision: int = Field(ge=0)


class ScriptSource(WorkflowModel):
    scene_id: Identifier
    revision: int = Field(ge=0)


class CardData(WorkflowModel):
    kind: Literal["character", "scene", "prop"]
    title: Title
    design: LongText = ""
    voice_asset_id: Identifier | None = None
    source: ScriptSource | None = None
    parent_id: Identifier | None = None
    parent_asset_id: Identifier | None = None
    candidate_task_ids: list[Identifier] = Field(default_factory=list, max_length=80)
    candidate_asset_ids: list[Identifier] = Field(default_factory=list, max_length=80)
    adopted_asset_id: Identifier | None = None
    model_asset_key: Annotated[str, StringConstraints(max_length=180)] | None = None
    archived: bool = False

    @model_validator(mode="after")
    def validate_voice(self):
        if self.voice_asset_id is not None and self.kind != "character":
            raise ValueError("只有角色卡可以绑定角色语音")
        return self


def current_card_data(value: dict) -> dict:
    """Read legacy records/archives without reviving retired design fields."""
    return {key: item for key, item in value.items() if key not in {"facts", "proposed_design"}}


class CardUpdate(CardData):
    expected_revision: int = Field(ge=0)


class CardOut(CardData):
    id: Identifier
    revision: int = Field(ge=0)
    source_project_id: str | None = None
    media_projects: dict[str, str | None] = Field(default_factory=dict)
