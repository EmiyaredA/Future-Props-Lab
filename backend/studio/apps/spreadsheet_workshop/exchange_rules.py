"""Explicitly supported Excel validation and conditional-format conversions."""

import re

from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from .schemas import SpreadsheetError

OPERATORS = {
    "equal": "equal",
    "notEqualTo": "notEqual",
    "moreThanThe": "greaterThan",
    "lessThan": "lessThan",
    "greaterOrEqualTo": "greaterThanOrEqual",
    "lessThanOrEqualTo": "lessThanOrEqual",
    "between": "between",
    "notBetween": "notBetween",
}
CF_OPERATORS = {
    "greaterThan": "greaterThan",
    "lessThan": "lessThan",
    "equal": "equal",
    "betweenness": "between",
}


def rgb(color):
    return "#" + color.rgb[-6:] if color is not None and color.type == "rgb" else None


def excel_color(value):
    if not isinstance(value, str):
        raise SpreadsheetError("颜色格式无法导出", "unsupported_export_style")
    if re.fullmatch(r"#[0-9a-fA-F]{3}", value):
        return "".join(char * 2 for char in value[1:])
    if re.fullmatch(r"#?[0-9a-fA-F]{6}", value):
        return value.lstrip("#")
    match = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)", value)
    if match and all(int(part) <= 255 for part in match.groups()):
        return "".join(f"{int(part):02X}" for part in match.groups())
    raise SpreadsheetError("颜色格式无法导出", "unsupported_export_style")


def range_text(item):
    top, bottom = item["row"]
    left, right = item["column"]
    return f"{get_column_letter(left + 1)}{top + 1}:{get_column_letter(right + 1)}{bottom + 1}"


def read_rules(ws, warnings):
    validation = {}
    for rule in ws.data_validations.dataValidation:
        literal_list = rule.type == "list" and str(rule.formula1 or "").startswith('"')
        numeric = rule.type in {"whole", "decimal"} and rule.operator in OPERATORS.values()
        if not (literal_list or numeric):
            warnings.append(f"{ws.title}：数据校验 {rule.sqref} 暂不支持")
            continue
        config = {
            "type": "dropdown"
            if literal_list
            else ("number_integer" if rule.type == "whole" else "number_decimal"),
            "type2": next((k for k, v in OPERATORS.items() if v == rule.operator), "equal"),
            "value1": str(rule.formula1 or "").strip('"'),
            "value2": str(rule.formula2 or ""),
            "remote": False,
            "prohibitInput": bool(rule.showErrorMessage),
            "hintShow": bool(rule.showInputMessage),
            "hintValue": rule.prompt or "",
        }
        count = 0
        for area in rule.sqref.ranges:
            if area.max_row > ws.max_row or area.max_col > ws.max_column:
                warnings.append(f"{ws.title}：超出已用网格的数据校验范围已裁剪")
            for row in range(area.min_row, min(area.max_row, ws.max_row) + 1):
                for col in range(area.min_col, min(area.max_col, ws.max_column) + 1):
                    count += 1
                    if count > 100_000:
                        raise SpreadsheetError("数据校验范围过大", "workbook_limit")
                    validation[f"{row - 1}_{col - 1}"] = config
    conditions = []
    for area in ws.conditional_formatting:
        for rule in ws.conditional_formatting[area]:
            operator = next((k for k, v in CF_OPERATORS.items() if v == rule.operator), None)
            if rule.type == "expression":
                operator = "formula"
            if not operator or rule.type not in {"cellIs", "expression"}:
                warnings.append(f"{ws.title}：条件格式 {area.sqref} 的 {rule.type} 规则暂不支持")
                continue
            if rule.stopIfTrue or (rule.dxf and (rule.dxf.border or rule.dxf.numFmt)):
                warnings.append(
                    f"{ws.title}：条件格式仅保留字体颜色和填充，不保留停止规则、边框或数字格式"
                )
            conditions.append(
                {
                    "type": "default",
                    "conditionName": operator,
                    "conditionValue": [*rule.formula, ""][:2],
                    "cellrange": [
                        {
                            "row": [r.min_row - 1, r.max_row - 1],
                            "column": [r.min_col - 1, r.max_col - 1],
                        }
                        for r in area.sqref.ranges
                    ],
                    "format": {
                        "textColor": rgb(rule.dxf.font.color)
                        if rule.dxf and rule.dxf.font
                        else None,
                        "cellColor": rgb(rule.dxf.fill.fgColor)
                        if rule.dxf and rule.dxf.fill
                        else None,
                    },
                }
            )
    return validation, conditions


def write_rules(ws, sheet):
    for key, item in (sheet.model_extra or {}).get("dataVerification", {}).items():
        row, col = (int(n) for n in key.split("_"))
        kind = item.get("type")
        if kind not in {"dropdown", "number", "number_integer", "number_decimal"}:
            raise SpreadsheetError("当前数据校验类型不能导出为 XLSX", "unsupported_export_rule")
        rule = DataValidation(
            type="list"
            if kind == "dropdown"
            else ("whole" if kind == "number_integer" else "decimal"),
            operator=None if kind == "dropdown" else OPERATORS.get(item.get("type2"), "equal"),
            formula1='"' + item.get("value1", "").replace('"', '""') + '"'
            if kind == "dropdown"
            else item.get("value1"),
            formula2=item.get("value2") or None,
            showErrorMessage=bool(item.get("prohibitInput")),
            showInputMessage=bool(item.get("hintShow")),
            prompt=item.get("hintValue") or None,
        )
        ws.add_data_validation(rule)
        rule.add(ws.cell(row + 1, col + 1))
    for item in (sheet.model_extra or {}).get("luckysheet_conditionformat_save", []):
        name = item.get("conditionName")
        if name not in {*CF_OPERATORS, "formula"}:
            raise SpreadsheetError("当前条件格式类型不能导出为 XLSX", "unsupported_export_rule")
        fmt = item.get("format", {})
        fill = (
            PatternFill("solid", fgColor=excel_color(fmt["cellColor"]))
            if fmt.get("cellColor")
            else None
        )
        font = Font(color=excel_color(fmt["textColor"])) if fmt.get("textColor") else None
        values = [str(v).lstrip("=") for v in item.get("conditionValue", [])]
        rule = (
            FormulaRule(formula=values[:1], fill=fill, font=font)
            if name == "formula"
            else CellIsRule(
                operator=CF_OPERATORS[name],
                formula=values[:2] if name == "betweenness" else values[:1],
                fill=fill,
                font=font,
            )
        )
        for area in item.get("cellrange", []):
            ws.conditional_formatting.add(range_text(area), rule)
