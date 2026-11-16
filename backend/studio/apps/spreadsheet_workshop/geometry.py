"""Bound native renderer and exporter metadata before accepting a snapshot."""

import re

MAX_RULES = 100_000


def validate_geometry(sheet):
    covered = 0

    def integer(value, maximum):
        if type(value) is not int or not 0 <= value < maximum:
            raise ValueError("工作表配置坐标超出范围")

    def position(row, column):
        integer(row, sheet.row)
        integer(column, sheet.column)

    def area(value):
        nonlocal covered
        if not isinstance(value, dict) or not {"row", "column"} <= value.keys():
            raise ValueError("区域配置无效")
        rows, columns = value["row"], value["column"]
        if (
            not isinstance(rows, list)
            or not isinstance(columns, list)
            or len(rows) != 2
            or len(columns) != 2
        ):
            raise ValueError("区域配置无效")
        position(rows[0], columns[0])
        position(rows[1], columns[1])
        if rows[1] < rows[0] or columns[1] < columns[0]:
            raise ValueError("区域配置顺序无效")
        covered += (rows[1] - rows[0] + 1) * (columns[1] - columns[0] + 1)
        if covered > 1_000_000:
            raise ValueError("格式规则覆盖区域过大")

    extras = sheet.model_extra or {}
    allowed = {
        "hide",
        "color",
        "frozen",
        "filter",
        "filter_select",
        "dataVerification",
        "luckysheet_conditionformat_save",
        "luckysheet_alternateformat_save",
        "hyperlink",
        "showGridLines",
        "defaultRowHeight",
        "defaultColWidth",
    }
    if set(extras) - allowed:
        raise ValueError("工作表含未登记的配置字段")
    for key in ("rowlen", "columnlen", "rowhidden", "colhidden", "customHeight", "customWidth"):
        value = sheet.config.get(key, {})
        if not isinstance(value, dict):
            raise ValueError("行列配置无效")
        for index, size in value.items():
            if not str(index).isdigit():
                raise ValueError("行列配置坐标无效")
            integer(
                int(index),
                sheet.row if "row" in key.lower() or key == "customHeight" else sheet.column,
            )
            if not isinstance(size, (int, float)) or not 0 <= size <= 10_000:
                raise ValueError("行列尺寸无效")
    for merge in sheet.config.get("merge", {}).values():
        position(merge["r"], merge["c"])
        integer(merge["rs"] - 1, sheet.row)
        integer(merge["cs"] - 1, sheet.column)
        position(merge["r"] + merge["rs"] - 1, merge["c"] + merge["cs"] - 1)
    borders = sheet.config.get("borderInfo", [])
    if not isinstance(borders, list) or len(borders) > MAX_RULES:
        raise ValueError("边框配置过多")
    for border in borders:
        if border.get("rangeType") == "cell":
            position(border["value"]["row_index"], border["value"]["col_index"])
        else:
            for region in border.get("range", []):
                area(region)
    if extras.get("filter_select"):
        area(extras["filter_select"])
    for collection in ("dataVerification", "hyperlink"):
        value = extras.get(collection, {})
        if not isinstance(value, dict) or len(value) > MAX_RULES:
            raise ValueError("单元格配置过多")
        for key in value:
            if not re.fullmatch(r"\d+_\d+", key):
                raise ValueError("单元格配置坐标无效")
            position(*(int(item) for item in key.split("_")))
    conditions = extras.get("luckysheet_conditionformat_save", [])
    if not isinstance(conditions, list) or len(conditions) > 1000:
        raise ValueError("条件格式规则过多")
    for condition in conditions:
        for region in condition.get("cellrange", []):
            area(region)
    if extras.get("frozen"):
        region = extras["frozen"].get("range", {})
        for field, maximum in (("row_focus", sheet.row), ("column_focus", sheet.column)):
            value = region.get(field, 0)
            if type(value) is not int or not -1 <= value < maximum:
                raise ValueError("冻结区域无效")
