"""Public typed contracts for atomic table editing and bounded queries."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_serializer

FieldType = Literal[
    "text", "number", "single", "multi", "date", "checkbox", "url", "attachment", "note"
]
CellValue = str | float | bool | list[str] | None


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class SelectOption(Contract):
    id: str = Field(min_length=1, max_length=36, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    color: str = Field(default="#7c89c9", pattern=r"^#[0-9a-fA-F]{6}$")


DateFormat = Literal[
    "YYYY-MM-DD", "YYYY/MM/DD", "YYYY.MM.DD", "YYYY年M月D日", "DD/MM/YYYY", "MM/DD/YYYY"
]


class FieldConfig(Contract):
    date_format: DateFormat | None = None
    decimal_places: StrictInt | None = Field(default=None, ge=0, le=8)
    use_grouping: StrictBool | None = None

    @model_serializer(mode="wrap")
    def compact(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}


class FieldSpec(Contract):
    id: str = Field(min_length=1, max_length=36, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    type: FieldType
    position: int = Field(ge=0)
    options: list[SelectOption] = Field(default_factory=list, max_length=100)
    config: FieldConfig = Field(default_factory=FieldConfig)


class Filter(Contract):
    field_id: str
    operator: Literal["eq", "ne", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty"]
    value: CellValue = None


class Sort(Contract):
    field_id: str
    direction: Literal["asc", "desc"] = "asc"


class ViewConfig(Contract):
    filters: list[Filter] = Field(default_factory=list, max_length=30)
    filter_mode: Literal["all", "any"] = "all"
    sorts: list[Sort] = Field(default_factory=list, max_length=10)
    group_field_id: str | None = None
    column_order: list[str] = Field(default_factory=list, max_length=50)
    hidden_fields: list[str] = Field(default_factory=list, max_length=50)
    column_widths: dict[str, int] = Field(default_factory=dict, max_length=50)
    stack_field_id: str | None = None
    date_field_id: str | None = None


class ViewSpec(Contract):
    id: str = Field(min_length=1, max_length=36, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    type: Literal["grid", "kanban", "calendar"] = "grid"
    position: int = Field(ge=0)
    config: ViewConfig = Field(default_factory=ViewConfig)


class RecordSpec(Contract):
    id: str = Field(min_length=1, max_length=36, pattern=r"^[a-zA-Z0-9_-]+$")
    position: int = Field(ge=0)
    values: dict[str, CellValue] = Field(max_length=50)


class TableSpec(Contract):
    id: str = Field(min_length=1, max_length=36, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    position: int = Field(ge=0)
    fields: list[FieldSpec] = Field(min_length=1, max_length=50)
    views: list[ViewSpec] = Field(min_length=1, max_length=30)


class Structure(Contract):
    note_id: str
    revision: int
    tables: list[TableSpec]
    role: Literal["read", "edit", "manage"] = "edit"
    can_edit: bool = True
    can_manage: bool = False
    publication_id: str | None = None


class QueryIn(Contract):
    view_id: str | None = None
    search: str = Field(default="", max_length=240)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=200)


class RecordPage(Contract):
    revision: int
    items: list[RecordSpec]
    total: int
    groups: dict[str, int] = Field(default_factory=dict)


class TablePut(Contract):
    op: Literal["table.put"]
    table: TableSpec


class TableDelete(Contract):
    op: Literal["table.delete"]
    table_id: str


class RecordsPut(Contract):
    op: Literal["records.put"]
    table_id: str
    records: list[RecordSpec] = Field(min_length=1, max_length=5000)


class RecordsDelete(Contract):
    op: Literal["records.delete"]
    table_id: str
    ids: list[str] = Field(min_length=1, max_length=5000)


Operation = Annotated[
    TablePut | TableDelete | RecordsPut | RecordsDelete, Field(discriminator="op")
]


class BatchIn(Contract):
    expected_revision: int = Field(ge=0)
    operations: list[Operation] = Field(min_length=1, max_length=100)


class BatchOut(Contract):
    structure: Structure
    records: dict[str, list[RecordSpec]] = Field(default_factory=dict)


class ConversionIn(Contract):
    table: TableSpec


class ConversionOut(Contract):
    valid: bool
    errors: list[dict]
    affected_records: int
    samples: list[dict] = Field(default_factory=list)


class CsvIn(Contract):
    expected_revision: int = Field(ge=0)
    csv: str = Field(max_length=8 * 1024 * 1024)
    mapping: list[str | None] = Field(min_length=1, max_length=50)
    header: bool = True
    table: TableSpec | None = None


class CsvPreview(Contract):
    headers: list[str]
    rows: list[list[str]]
    total: int
    errors: list[dict]


class CsvSource(Contract):
    csv: str = Field(max_length=8 * 1024 * 1024)
    header: bool = True
    table: TableSpec | None = None
    mapping: list[str | None] | None = Field(default=None, max_length=50)


class ChangeSummary(Contract):
    id: str
    revision: int
    author_id: str | None
    created_at: datetime


class Snapshot(Contract):
    tables: list[TableSpec]
    records: dict[str, list[RecordSpec]]


class RestoreIn(Contract):
    expected_revision: int = Field(ge=0)
