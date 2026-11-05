from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from studio.contracts.model_service.schemas.model_service import (
    ModelCapability,
    ModelCategory,
    ProviderIn,
)
from studio.contracts.model_service.schemas.provider_types import ProviderKind

PlatformRole = Literal["admin", "user"]


class TemplateModel(BaseModel):
    template_key: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=160)
    label: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=255)
    capabilities: list[ModelCapability] = Field(default_factory=lambda: ["chat"])
    categories: list[ModelCategory] = Field(default_factory=list)
    enabled: bool = True


class TemplateSupplier(BaseModel):
    template_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)


class TemplateProvider(BaseModel):
    supplier_key: str | None = None
    template_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    kind: ProviderKind
    base_url: str = Field(default="", max_length=512)
    api_key: str = Field(default="", max_length=4096, exclude=True)
    clear_api_key: bool = Field(default=False, exclude=True)
    has_api_key: bool = False
    api_key_hint: str = ""
    enabled: bool = True
    models: list[TemplateModel] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_url(self):
        self.base_url = ProviderIn(
            expected_catalog_revision=0, name=self.name, kind=self.kind, base_url=self.base_url
        ).base_url
        return self


class RoleModelTemplate(BaseModel):
    suppliers: list[TemplateSupplier] = Field(default_factory=list)
    providers: list[TemplateProvider] = Field(default_factory=list)
    defaults: dict[ModelCapability, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_keys(self):
        supplier_keys = [item.template_key for item in self.suppliers]
        if len(supplier_keys) != len(set(supplier_keys)):
            raise ValueError("供应商模板标识不能重复")
        if any(
            p.supplier_key is not None and p.supplier_key not in supplier_keys
            for p in self.providers
        ):
            raise ValueError("连接引用了不存在的供应商")
        keys = [item.template_key for item in self.providers]
        models = [model for provider in self.providers for model in provider.models]
        if len(keys) != len(set(keys)) or len({m.template_key for m in models}) != len(models):
            raise ValueError("模板标识不能重复")
        for provider in self.providers:
            slugs = [m.slug.casefold() for m in provider.models]
            if len(slugs) != len(set(slugs)):
                raise ValueError("同一连接内模型名称不能重复")
        for purpose, key in self.defaults.items():
            if not any(
                m.template_key == key and purpose in m.capabilities and m.enabled and p.enabled
                for p in self.providers
                for m in p.models
            ):
                raise ValueError("默认模型必须启用并支持对应能力")
        return self


class RoleModelTemplateOut(BaseModel):
    role: PlatformRole
    revision: int
    value: RoleModelTemplate


class RoleModelTemplateIn(BaseModel):
    expected_revision: int = Field(ge=0)
    value: RoleModelTemplate


class TemplatePreviewIn(BaseModel):
    expected_template_revision: int = Field(ge=0)
    account_ids: list[str] | None = Field(default=None, min_length=1, max_length=1000)


class TemplateSyncIn(BaseModel):
    expected_revision: int = Field(ge=0)


class TemplateSyncItemOut(BaseModel):
    id: str
    owner_user_id: str
    account_name: str
    catalog_revision: int
    status: str
    summary: dict[str, list[str]]
    error_message: str


class TemplateSyncJobOut(BaseModel):
    id: str
    role: PlatformRole
    template_revision: int
    status: str
    revision: int
    created_at: datetime
    items: list[TemplateSyncItemOut]
