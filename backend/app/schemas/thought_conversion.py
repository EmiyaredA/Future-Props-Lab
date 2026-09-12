from pydantic import BaseModel, ConfigDict, Field


class ThoughtMarkdownIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    markdown: str = Field(max_length=200000)
    assets: dict[str, str] = Field(default_factory=dict, max_length=500)


class ThoughtMarkdownOut(BaseModel):
    document: dict
    warnings: list[str]
