"""Editable prompt variants shared by the three media generation drafts."""

from pydantic import BaseModel, Field, field_validator, model_validator


class VisualPromptVersion(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(default="", max_length=6000)

    @field_validator("id", "name")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("提示词版本 ID 和名称不能为空")
        return value.strip()


class VisualPromptDraft(BaseModel):
    prompt: str = Field(default="", max_length=6000)
    prompt_versions: list[VisualPromptVersion] = Field(
        default_factory=list, min_length=1, max_length=20
    )
    active_prompt_version_id: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def valid_prompt_versions(self):
        supplied = self.model_fields_set & {"prompt_versions", "active_prompt_version_id"}
        if not supplied:
            # Preserve fields_set so the canvas owner can merge legacy updates with stored variants.
            object.__setattr__(
                self,
                "prompt_versions",
                [VisualPromptVersion(id="v1", name="v1", prompt=self.prompt)],
            )
            object.__setattr__(self, "active_prompt_version_id", "v1")
            return self
        if len(supplied) != 2:
            raise ValueError("提示词版本列表和当前版本必须同时提供")
        ids = [version.id for version in self.prompt_versions]
        if len(ids) != len(set(ids)):
            raise ValueError("提示词版本 ID 不能重复")
        active = next(
            (
                version
                for version in self.prompt_versions
                if version.id == self.active_prompt_version_id
            ),
            None,
        )
        if active is None:
            raise ValueError("当前提示词版本不存在")
        if active.prompt != self.prompt:
            raise ValueError("提示词必须与当前版本内容一致")
        return self
