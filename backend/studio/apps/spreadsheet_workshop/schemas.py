"""Versioned workbook snapshots; FortuneSheet is isolated behind this envelope."""

import json
import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.runtime.project_preview import ProjectPreview

from .geometry import validate_geometry

MAX_UPLOAD = 20 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024
MAX_CELLS = 100_000
MAX_GRID = 1_000_000
CONVERTER = "spreadsheet-v1"


class SpreadsheetError(Exception):
    def __init__(self, message, code="invalid_workbook", status=422):
        super().__init__(message)
        self.code, self.status = code, status


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SparseCell(Wire):
    r: int = Field(ge=0, lt=100_000)
    c: int = Field(ge=0, lt=16_384)
    v: dict[str, Any]


class Sheet(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1, max_length=64, pattern=r"^[\w-]+$")
    name: str = Field(min_length=1, max_length=31)
    row: int = Field(default=100, ge=1, le=100_000)
    column: int = Field(default=26, ge=1, le=16_384)
    celldata: list[SparseCell] = Field(default_factory=list, max_length=MAX_CELLS)
    config: dict[str, Any] = Field(default_factory=dict)
    order: int = Field(default=0, ge=0)
    status: int = Field(default=0, ge=0, le=1)

    @model_validator(mode="after")
    def valid_sheet(self):
        if (
            re.search(r"[\\/*?:\[\]]", self.name)
            or self.name.startswith("'")
            or self.name.endswith("'")
        ):
            raise ValueError("工作表名称无效")
        if "data" in (self.model_extra or {}) or self.config.get("images"):
            raise ValueError("只接受稀疏单元格快照，不支持嵌入图片")
        seen = set()
        try:
            validate_geometry(self)
        except (KeyError, TypeError, AttributeError) as exc:
            raise ValueError("工作表配置格式无效") from exc
        for cell in self.celldata:
            position = cell.r, cell.c
            if position in seen or cell.r >= self.row or cell.c >= self.column:
                raise ValueError("单元格重复或超出工作表范围")
            seen.add(position)
            if not isinstance(cell.v.get("v"), (str, int, float, bool, type(None))):
                raise ValueError("单元格值只能是文本、数值或布尔值")
            if cell.v.get("ct") is not None and not isinstance(cell.v["ct"], dict):
                raise ValueError("单元格格式无效")
            if cell.v.get("f") and not str(cell.v["f"]).startswith("="):
                raise ValueError("公式必须以等号开头")
        return self


class SpreadsheetDocument(Wire):
    schema_version: Literal[1] = 1
    sheets: list[Sheet] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def valid_document(self):
        visible = next(
            (sheet for sheet in self.sheets if not (sheet.model_extra or {}).get("hide")), None
        )
        if visible is None:
            raise ValueError("至少需要一张可见工作表")
        for sheet in self.sheets:
            sheet.status = int(sheet is visible)
        if len({s.id for s in self.sheets}) != len(self.sheets):
            raise ValueError("工作表 ID 重复")
        if len({s.name.casefold() for s in self.sheets}) != len(self.sheets):
            raise ValueError("工作表名称重复")
        if sum(len(s.celldata) for s in self.sheets) > MAX_CELLS:
            raise ValueError("最多支持十万个非空单元格")
        if sum(s.row * s.column for s in self.sheets) > MAX_GRID:
            raise ValueError("工作簿网格超过一百万个单元格")
        raw = self.model_dump(mode="python")

        def safe(value, depth=0):
            if depth > 32:
                raise ValueError("单元格结构过深")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("单元格数值必须有限")
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in {"__proto__", "constructor", "prototype", "images"}:
                        raise ValueError("工作簿含不支持的字段")
                    safe(item, depth + 1)
            elif isinstance(value, list):
                for item in value:
                    safe(item, depth + 1)
            elif isinstance(value, str):
                if len(value) > 32_767:
                    raise ValueError("单元格文本过长")
                if re.match(r"\s*(?:javascript|data|file|vbscript):", value, re.I):
                    raise ValueError("不支持此链接协议")

        safe(raw)
        if len(json.dumps(raw, ensure_ascii=False).encode()) > MAX_UPLOAD:
            raise ValueError("工作簿快照超过 20 MiB")
        return self


class SpreadsheetCreate(Wire):
    request_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="未命名工作簿", min_length=1, max_length=120)
    document: SpreadsheetDocument | None = None


class SpreadsheetPut(Wire):
    request_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=120)
    document: SpreadsheetDocument
    calculated: bool = False


class SpreadsheetSummary(Wire):
    preview: ProjectPreview | None = None
    id: str
    title: str
    revision: int
    calculation: Literal["pending", "browser_calculated", "not_needed"]
    created_at: str
    updated_at: str
    source_name: str | None = None


class SpreadsheetProject(SpreadsheetSummary):
    document: SpreadsheetDocument


class SpreadsheetList(Wire):
    items: list[SpreadsheetSummary]
    total: int


class SpreadsheetOperation(Wire):
    action: Literal[
        "set_cells",
        "clear_range",
        "style_range",
        "add_sheet",
        "rename_sheet",
        "delete_sheet",
        "reorder_sheets",
    ]
    sheet_id: str | None = None
    range: str | None = None
    cells: list[SparseCell] = Field(default_factory=list, max_length=10_000)
    style: dict[str, Any] = Field(default_factory=dict)
    name: str | None = Field(default=None, min_length=1, max_length=31)
    sheet_order: list[str] = Field(default_factory=list, max_length=20)


class SpreadsheetOperations(Wire):
    request_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=0)
    operations: list[SpreadsheetOperation] = Field(min_length=1, max_length=1000)


class SpreadsheetImportPreview(Wire):
    id: str
    sha256: str
    converter: str = CONVERTER
    filename: str
    warnings: list[str]
    sheets: list[str]


class SpreadsheetImportConfirm(Wire):
    request_id: str = Field(min_length=1, max_length=64)
    sha256: str
    converter: Literal["spreadsheet-v1"]
    accept_warnings: bool = False
    title: str | None = Field(default=None, min_length=1, max_length=120)


class SpreadsheetExport(Wire):
    expected_revision: int = Field(ge=0)
    format: Literal["xlsx", "csv"] = "xlsx"
    sheet_id: str | None = None
    value_mode: Literal["values", "formulas"] = "values"


class SpreadsheetRangeCell(Wire):
    row: int
    column: int
    value: Any = None
    formula: str | None = None
    calculation: str


class SpreadsheetRange(Wire):
    revision: int
    sheet_id: str
    range: str
    cells: list[SpreadsheetRangeCell]
