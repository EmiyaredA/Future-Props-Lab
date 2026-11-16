"""Pure workbook edits and reference transformations."""

import json
import re
from copy import deepcopy

from openpyxl.formula.tokenizer import Tokenizer, TokenizerError
from openpyxl.utils.cell import range_boundaries
from pydantic import ValidationError

from .schemas import MAX_CELLS, MAX_UPLOAD, Sheet, SpreadsheetDocument, SpreadsheetError


def default_document():
    return SpreadsheetDocument(sheets=[Sheet(id="sheet-1", name="工作表1", status=1)])


def has_formulas(document):
    return any(cell.v.get("f") for sheet in document.sheets for cell in sheet.celldata)


def bounds(address):
    if not re.fullmatch(r"\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?", address):
        raise SpreadsheetError("请输入 A1 或 A1:C10 形式的区域", "invalid_range")
    left, top, right, bottom = range_boundaries(address)
    if right < left or bottom < top:
        raise SpreadsheetError("区域结束位置必须在开始位置之后", "invalid_range")
    if right > 16_384 or bottom > 100_000 or (right - left + 1) * (bottom - top + 1) > 10_000:
        raise SpreadsheetError("单次区域最多一万个单元格", "range_limit")
    return top - 1, left - 1, bottom - 1, right - 1


def find_sheet(document, identity):
    for sheet in document.sheets:
        if sheet.id == identity:
            return sheet
    raise SpreadsheetError("工作表不存在", "sheet_not_found", 404)


def rewrite_reference(formula, old_name, new_name):
    try:
        tokens = Tokenizer(formula).items
    except TokenizerError:
        raise SpreadsheetError("公式无法安全更新工作表引用", "unsupported_formula") from None
    for token in tokens:
        if token.type != "OPERAND" or token.subtype != "RANGE" or "!" not in token.value:
            continue
        qualifier, cell_range = token.value.rsplit("!", 1)
        name = qualifier[1:-1].replace("''", "'") if qualifier.startswith("'") else qualifier
        if name.casefold() == old_name.casefold():
            token.value = (
                "#REF!"
                if new_name is None
                else "'" + new_name.replace("'", "''") + "'!" + cell_range
            )
        elif ":" in name and old_name.casefold() in name.casefold().split(":"):
            raise SpreadsheetError("请先移除三维工作表引用，再重命名或删除", "unsupported_formula")
    return "=" + "".join(token.value for token in tokens)


def apply_operations(document, operations):
    data = deepcopy(document.model_dump(mode="json"))
    work = expanded_styles = 0
    for op in operations:
        # Bound work before expanding compact range operations into per-cell objects.
        work += sum(len(item["celldata"]) for item in data["sheets"])
        if op.action == "set_cells":
            work += len(op.cells)
        if op.action in {"clear_range", "style_range"} and op.range:
            top, left, bottom, right = bounds(op.range)
            size = (bottom - top + 1) * (right - left + 1)
            work += size
            if op.action == "style_range":
                expanded_styles += size * len(json.dumps(op.style, ensure_ascii=False).encode())
        if work > 1_000_000 or expanded_styles > MAX_UPLOAD:
            raise SpreadsheetError("单批编辑工作量超过限制，请拆分操作", "operation_limit")
        if op.action == "add_sheet":
            if len(data["sheets"]) >= 20:
                raise SpreadsheetError("最多支持二十张工作表", "workbook_limit")
            if not op.sheet_id or any(s["id"] == op.sheet_id for s in data["sheets"]):
                raise SpreadsheetError("新增工作表需要唯一 sheet_id")
            item = default_document().sheets[0].model_dump()
            item.update(id=op.sheet_id, name=op.name or "新工作表", status=0)
            data["sheets"].append(item)
            continue
        if op.action == "reorder_sheets":
            if len(op.sheet_order) != len(set(op.sheet_order)) or set(op.sheet_order) != {
                s["id"] for s in data["sheets"]
            }:
                raise SpreadsheetError("工作表顺序必须完整且无重复")
            data["sheets"].sort(key=lambda s: op.sheet_order.index(s["id"]))
            continue
        sheet = next((s for s in data["sheets"] if s["id"] == op.sheet_id), None)
        if sheet is None:
            raise SpreadsheetError("工作表不存在", "sheet_not_found", 404)
        if op.action in {"rename_sheet", "delete_sheet"}:
            if op.action == "delete_sheet" and len(data["sheets"]) == 1:
                raise SpreadsheetError("不能删除最后一张工作表")
            if op.action == "rename_sheet" and not op.name:
                raise SpreadsheetError("请输入工作表名称")
            for item in data["sheets"]:
                for cell in item["celldata"]:
                    if cell["v"].get("f"):
                        cell["v"]["f"] = rewrite_reference(
                            cell["v"]["f"],
                            sheet["name"],
                            op.name if op.action == "rename_sheet" else None,
                        )
            if op.action == "delete_sheet":
                data["sheets"].remove(sheet)
            else:
                sheet["name"] = op.name
            continue
        cells = {(cell["r"], cell["c"]): cell for cell in sheet["celldata"]}
        if op.action == "set_cells":
            for cell in op.cells:
                cells[(cell.r, cell.c)] = cell.model_dump(mode="json")
                sheet["row"] = max(sheet["row"], cell.r + 1)
                sheet["column"] = max(sheet["column"], cell.c + 1)
        else:
            if not op.range:
                raise SpreadsheetError("操作需要指定 range")
            top, left, bottom, right = bounds(op.range)
            if op.action == "style_range" and set(op.style) - {
                "bg",
                "fc",
                "ff",
                "fs",
                "bl",
                "it",
                "un",
                "ht",
                "vt",
                "tb",
                "ct",
            }:
                raise SpreadsheetError("不支持此格式字段")
            for row in range(top, bottom + 1):
                for col in range(left, right + 1):
                    if op.action == "clear_range":
                        cells.pop((row, col), None)
                    else:
                        cell = cells.setdefault((row, col), {"r": row, "c": col, "v": {}})
                        cell["v"].update(op.style)
            sheet["row"] = max(sheet["row"], bottom + 1)
            sheet["column"] = max(sheet["column"], right + 1)
        sheet["celldata"] = sorted(cells.values(), key=lambda c: (c["r"], c["c"]))
        if sum(len(item["celldata"]) for item in data["sheets"]) > MAX_CELLS:
            raise SpreadsheetError("最多支持十万个非空单元格", "workbook_limit")
    for index, sheet in enumerate(data["sheets"]):
        sheet["order"] = index
    try:
        return SpreadsheetDocument.model_validate(data)
    except ValidationError as exc:
        raise SpreadsheetError(
            "编辑后的工作簿格式无效，请检查名称、坐标或格式", "invalid_operation"
        ) from exc
