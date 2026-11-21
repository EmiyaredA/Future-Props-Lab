"""Project-local connections between shared cards and editable 3D documents."""

from pydantic import Field, model_validator

from studio.apps.visual_workshop.schemas.creative_workflow import Identifier, WorkflowModel


class SceneBinding(WorkflowModel):
    card_id: Identifier
    previs_scene_id: Identifier


class ObjectBinding(WorkflowModel):
    previs_scene_id: Identifier
    object_id: str = Field(min_length=1, max_length=160)
    card_id: Identifier


class CreationLinks(WorkflowModel):
    scenes: list[SceneBinding] = Field(default_factory=list, max_length=500)
    objects: list[ObjectBinding] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def unique_bindings(self):
        if len({row.card_id for row in self.scenes}) != len(self.scenes):
            raise ValueError("同一场景卡只能绑定一个3D场景")
        if len({(row.previs_scene_id, row.object_id) for row in self.objects}) != len(self.objects):
            raise ValueError("同一白模对象只能关联一张设定卡")
        return self


class CreationLinksOut(CreationLinks):
    revision: int = Field(ge=0)


class CreationLinksUpdate(CreationLinks):
    expected_revision: int = Field(ge=0)
