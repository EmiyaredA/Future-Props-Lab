from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ModelSupplierIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("供应商名称不能为空")
        return value


class ModelSupplierOut(BaseModel):
    id: str
    name: str
    origin: Literal["user", "role_template"] = "user"
    template_key: str | None = None
    managed_fields: list[str] = Field(default_factory=list)


class ModelSupplierMutationOut(BaseModel):
    revision: int
    supplier: ModelSupplierOut
