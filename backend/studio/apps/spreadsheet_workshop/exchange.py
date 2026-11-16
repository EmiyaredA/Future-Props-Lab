"""Bounded XLSX/CSV interchange, independent from browser and community plugins."""

import csv
import io
import re
import zipfile
from datetime import date, datetime, time, timedelta
from pathlib import PurePath

from defusedxml.ElementTree import iterparse
from openpyxl import Workbook, load_workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import column_index_from_string, get_column_letter
from openpyxl.utils.cell import range_boundaries
from openpyxl.utils.datetime import to_excel
from openpyxl.utils.exceptions import IllegalCharacterError
from openpyxl.workbook.properties import CalcProperties

from .exchange_rules import excel_color, read_rules, rgb, write_rules
from .rules import find_sheet
from .schemas import (
    MAX_CELLS,
    MAX_EXPANDED,
    MAX_GRID,
    MAX_UPLOAD,
    Sheet,
    SpreadsheetDocument,
    SpreadsheetError,
)

BORDER_STYLES = {
    "thin": 1,
    "hair": 2,
    "dotted": 3,
    "dashed": 4,
    "dashDot": 5,
    "dashDotDot": 6,
    "double": 7,
    "medium": 8,
    "mediumDashed": 9,
    "mediumDashDot": 10,
    "mediumDashDotDot": 11,
    "slantDashDot": 12,
    "thick": 13,
}


def inspect_xml(archive, member, warnings, counts):
    worksheet = member.filename.lower().startswith("xl/worksheets/")
    rows, columns, merged = 100, 26, 0
    with archive.open(member) as stream:
        for event, node in iterparse(stream, events=("start", "end")):
            tag = node.tag.rsplit("}", 1)[-1]
            if event == "start":
                worksheet = worksheet or tag == "worksheet"
                continue
            if tag == "extLst":
                warnings.append("部分 Excel 扩展属性不受支持，仅保留已映射的表格内容")
            if tag == "rPr":
                warnings.append("单元格内的混合文字样式将转换为普通文字")
            if tag in {"t", "f"} and len(node.text or "") > 32_767:
                raise SpreadsheetError("单元格文本过长", "workbook_limit")
            category = (
                "cells"
                if worksheet and tag == "c"
                else "strings"
                if tag == "si"
                else "styles"
                if tag == "xf"
                else None
            )
            if category:
                counts[category] = counts.get(category, 0) + 1
                if counts[category] > (10_000 if category == "styles" else MAX_CELLS):
                    raise SpreadsheetError("工作簿单元格、文字或样式数量超过限制", "workbook_limit")
            if worksheet and tag in {"c", "mergeCell"}:
                address = node.get("r" if tag == "c" else "ref")
                if not address:
                    raise SpreadsheetError("工作簿坐标缺失")
                left, top, right, bottom = range_boundaries(address)
                if not all(
                    isinstance(value, int) and value > 0 for value in (left, top, right, bottom)
                ):
                    raise SpreadsheetError("工作簿坐标无效")
                rows, columns = max(rows, bottom), max(columns, right)
                if tag == "mergeCell":
                    merged += (right - left + 1) * (bottom - top + 1)
                if (
                    rows > 100_000
                    or columns > 16_384
                    or rows * columns > MAX_GRID
                    or merged > MAX_GRID
                ):
                    raise SpreadsheetError("工作簿网格超过限制", "workbook_limit")
            node.clear()


def inspect_zip(content):
    warnings = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            if len(members) > 10_000 or sum(m.file_size for m in members) > MAX_EXPANDED:
                raise SpreadsheetError("工作簿解压后超过限制", "workbook_limit")
            names = [m.filename for m in members]
            if len(names) != len(set(names)):
                raise SpreadsheetError("工作簿包含重复成员")
            counts = {}
            for member in members:
                path = PurePath(member.filename)
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or "\\" in member.filename
                    or member.flag_bits & 1
                ):
                    raise SpreadsheetError("工作簿压缩结构无效")
                if member.filename.lower().endswith((".xml", ".rels")):
                    # Stream-count before openpyxl allocates workbook objects.
                    inspect_xml(archive, member, warnings, counts)
            for prefix, label in (
                ("xl/charts/", "图表"),
                ("xl/pivot", "透视表"),
                ("xl/media/", "图片"),
                ("xl/drawings/", "绘图对象"),
                ("xl/externalLinks/", "外部工作簿链接"),
                ("xl/connections", "外部数据连接"),
                ("xl/vba", "宏"),
            ):
                if any(name.startswith(prefix) for name in names):
                    warnings.append(f"{label}不会进入可编辑副本；可下载导入原件")
            if "xl/workbook.xml" not in names:
                raise SpreadsheetError("文件不是 XLSX 工作簿")
    except (zipfile.BadZipFile, ValueError, OSError) as exc:
        raise SpreadsheetError("XLSX 文件损坏或格式无效") from exc
    return warnings


def import_document(content, filename, encoding="utf-8-sig"):
    if not content or len(content) > MAX_UPLOAD:
        raise SpreadsheetError("文件为空或超过 20 MiB", "upload_limit")
    suffix = PurePath(filename).suffix.lower()
    try:
        if suffix == ".csv":
            return read_csv(content, encoding), []
        if suffix != ".xlsx":
            raise SpreadsheetError("请选择 XLSX 或 CSV 文件", "unsupported_format")
        warnings = inspect_zip(content)
        workbook = load_workbook(io.BytesIO(content), data_only=False, keep_links=False)
        try:
            sheets = []
            if len(workbook.worksheets) > 20:
                raise SpreadsheetError("最多支持二十张工作表", "workbook_limit")
            if workbook.defined_names:
                warnings.append("工作簿命名区域暂不保留")
            if workbook.epoch.year == 1904:
                warnings.append("1904 日期系统已转换为 1900 日期系统")
            grid = 0
            count = 0
            for index, ws in enumerate(workbook.worksheets):
                rows, columns = max(ws.max_row, 100), max(ws.max_column, 26)
                grid += rows * columns
                if grid > MAX_GRID:
                    raise SpreadsheetError("工作簿网格超过一百万个单元格", "workbook_limit")
                sheet = read_sheet(ws, index, warnings)
                count += len(sheet.celldata)
                if count > MAX_CELLS:
                    raise SpreadsheetError("非空单元格超过十万个", "workbook_limit")
                sheets.append(sheet)
            return SpreadsheetDocument(sheets=sheets), list(dict.fromkeys(warnings))
        finally:
            workbook.close()
    except SpreadsheetError:
        raise
    except Exception as exc:
        raise SpreadsheetError("文件无法安全解析，请检查格式或大小", "invalid_file") from exc


def read_csv(content, encoding):
    if encoding not in {"utf-8-sig", "gb18030"}:
        raise SpreadsheetError("请选择 UTF-8 或 GB18030 编码")
    cells = []
    rows = columns = 0
    for row_index, row in enumerate(csv.reader(io.StringIO(content.decode(encoding)), strict=True)):
        rows = row_index + 1
        columns = max(columns, len(row))
        if max(rows, 100) * max(columns, 26) > MAX_GRID:
            raise SpreadsheetError("CSV 网格超过限制", "workbook_limit")
        for col, value in enumerate(row):
            if value == "":
                continue
            # Preserve leading zeroes and formula-looking text as literal text.
            number = re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", value)
            parsed = float(value) if number and "." in value else int(value) if number else value
            cells.append(
                {
                    "r": row_index,
                    "c": col,
                    "v": {"v": parsed, "ct": {"t": "n" if number else "s", "fa": "General"}},
                }
            )
            if len(cells) > MAX_CELLS:
                raise SpreadsheetError("CSV 非空单元格超过限制", "workbook_limit")
    return SpreadsheetDocument(
        sheets=[
            Sheet(
                id="sheet-1",
                name="工作表1",
                status=1,
                row=max(100, rows),
                column=max(26, columns),
                celldata=cells,
            )
        ]
    )


def read_sheet(ws, index, warnings):
    cells, borders = [], []
    for row in ws:
        for source in row:
            if source.value is None and not source.has_style and not source.comment:
                continue
            value = source.value
            cell = {
                "ct": {
                    "t": "s" if isinstance(value, str) else "b" if isinstance(value, bool) else "n",
                    "fa": source.number_format,
                },
                "ff": source.font.name or "Arial",
                "fs": source.font.sz or 11,
                "bl": int(bool(source.font.b)),
                "it": int(bool(source.font.i)),
                "un": int(bool(source.font.u)),
                "cl": int(bool(source.font.strike)),
                "ht": {"center": 0, "left": 1, "right": 2}.get(source.alignment.horizontal, 1),
                "vt": {"top": 1, "center": 0, "bottom": 2}.get(source.alignment.vertical, 2),
                "tb": "2" if source.alignment.wrap_text else "1",
            }
            if source.data_type == "f":
                if not isinstance(value, str):
                    warnings.append(f"{ws.title}：特殊数组公式未保留，请参照导入原件")
                else:
                    cell["f"] = value
                    cell["ct"]["t"] = "n"
                    if "[" in value or "_xlfn." in value:
                        warnings.append(f"{ws.title}：部分外部引用或扩展公式可能无法在浏览器计算")
            elif isinstance(value, (datetime, date, time, timedelta)):
                cell["v"] = to_excel(value)
            elif value is not None:
                cell["v"] = value
            if rgb(source.font.color):
                cell["fc"] = rgb(source.font.color)
            elif source.font.color is not None and not (
                source.font.color.type == "theme"
                and source.font.color.theme == 1
                and not source.font.color.tint
            ):
                warnings.append(f"{ws.title}：非 RGB 文字颜色已使用默认颜色")
            if source.fill.patternType == "solid" and rgb(source.fill.fgColor):
                cell["bg"] = rgb(source.fill.fgColor)
            elif source.fill.patternType:
                warnings.append(f"{ws.title}：非 RGB 或非纯色背景未保留")
            if (
                source.alignment.textRotation
                or source.alignment.shrinkToFit
                or source.font.u in {"double", "doubleAccounting", "singleAccounting"}
            ):
                warnings.append(f"{ws.title}：文字旋转、缩小或特殊下划线样式已简化")
            if source.comment:
                cell["ps"] = {
                    "value": source.comment.text,
                    "isShow": False,
                    "left": None,
                    "top": None,
                    "width": None,
                    "height": None,
                }
            if source.hyperlink:
                warnings.append(f"{ws.title}：超链接目标未保留，显示文本保留")
            r, c = source.row - 1, source.column - 1
            border = {"row_index": r, "col_index": c}
            for short, long in (("l", "left"), ("r", "right"), ("t", "top"), ("b", "bottom")):
                side = getattr(source.border, long)
                if side and side.style:
                    border[short] = {
                        "style": BORDER_STYLES.get(side.style, 1),
                        "color": rgb(side.color) or "#000000",
                    }
            if len(border) > 2:
                borders.append({"rangeType": "cell", "value": border})
            cells.append({"r": r, "c": c, "v": cell})
    config = {
        "merge": {},
        "rowlen": {},
        "columnlen": {},
        "borderInfo": borders,
        "rowhidden": {},
        "colhidden": {},
    }
    by_position = {(item["r"], item["c"]): item["v"] for item in cells}
    for merge in ws.merged_cells.ranges:
        r, c = merge.min_row - 1, merge.min_col - 1
        item = {"r": r, "c": c, "rs": merge.max_row - r, "cs": merge.max_col - c}
        config["merge"][f"{r}_{c}"] = item
        for row in range(r, merge.max_row):
            for col in range(c, merge.max_col):
                target = by_position.get((row, col))
                if target is None:
                    target = {}
                    by_position[(row, col)] = target
                    cells.append({"r": row, "c": col, "v": target})
                target["mc"] = item if (row, col) == (r, c) else {"r": r, "c": c}
    for row, dimension in ws.row_dimensions.items():
        if dimension.height:
            config["rowlen"][str(row - 1)] = dimension.height * 96 / 72
        if dimension.hidden:
            config["rowhidden"][str(row - 1)] = 0
    for col, dimension in ws.column_dimensions.items():
        start = column_index_from_string(col) - 1
        for index_col in range(start, max(start + 1, dimension.max or start + 1)):
            config["columnlen"][str(index_col)] = dimension.width * 7 + 5
            if dimension.hidden:
                config["colhidden"][str(index_col)] = 0
    extra = {}
    if ws.freeze_panes:
        pos = ws[ws.freeze_panes]
        extra["frozen"] = {
            "type": "rangeBoth",
            "range": {"row_focus": pos.row - 2, "column_focus": pos.column - 2},
        }
    if ws.auto_filter.ref:
        area = ws[ws.auto_filter.ref]
        extra["filter_select"] = {
            "row": [area[0][0].row - 1, area[-1][0].row - 1],
            "column": [area[0][0].column - 1, area[0][-1].column - 1],
        }
        if ws.auto_filter.filterColumn:
            warnings.append(f"{ws.title}：筛选区域已保留，原筛选条件未保留")
    if ws.tables or ws.protection.sheet:
        warnings.append(f"{ws.title}：结构化表或工作表保护设置未保留")
    verification, conditions = read_rules(ws, warnings)
    extra.update(dataVerification=verification, luckysheet_conditionformat_save=conditions)
    return Sheet(
        id=f"sheet-{index + 1}",
        name=ws.title,
        row=max(100, ws.max_row),
        column=max(26, ws.max_column),
        celldata=cells,
        config=config,
        order=index,
        status=int(index == 0),
        hide=int(ws.sheet_state != "visible"),
        **extra,
    )


def export_document(document, options):
    try:
        return convert_export(document, options)
    except SpreadsheetError:
        raise
    except (
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        IndexError,
        IllegalCharacterError,
    ) as exc:
        raise SpreadsheetError(
            "部分格式无法导出，请调整格式或导出 CSV", "unsupported_export_style"
        ) from exc


def plain_value(cell):
    runs = cell.get("ct", {}).get("s")
    return (
        "".join(str(run.get("v", "")) for run in runs)
        if isinstance(runs, list)
        else cell.get("v", "")
    )


def convert_export(document, options):
    if options.format == "csv":
        sheet = find_sheet(document, options.sheet_id or document.sheets[0].id)
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        used = [
            cell
            for cell in sheet.celldata
            if "v" in cell.v or "f" in cell.v or cell.v.get("ct", {}).get("s")
        ]
        bottom = max((cell.r for cell in used), default=0)
        right = max((cell.c for cell in used), default=0)
        cells = {(cell.r, cell.c): cell.v for cell in used}
        for row in range(bottom + 1):
            values = []
            for col in range(right + 1):
                cell = cells.get((row, col), {})
                value = (
                    cell.get("f")
                    if options.value_mode == "formulas" and cell.get("f")
                    else plain_value(cell)
                )
                # Values CSV is safe to open in spreadsheet programs.
                if (
                    options.value_mode == "values"
                    and isinstance(value, str)
                    and value.startswith(("=", "+", "-", "@", "\t", "\r"))
                ):
                    value = "'" + value
                values.append(value)
            writer.writerow(values)
        return stream.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"
    workbook = Workbook()
    workbook.remove(workbook.active)
    for sheet in document.sheets:
        write_sheet(workbook.create_sheet(sheet.name), sheet)
    if not any(ws.sheet_state == "visible" for ws in workbook):
        workbook.worksheets[0].sheet_state = "visible"
    workbook.calculation = CalcProperties(
        calcId=0, fullCalcOnLoad=True, forceFullCalc=True, calcMode="auto"
    )
    stream = io.BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def write_sheet(ws, sheet):
    extra = sheet.model_extra or {}
    if extra.get("luckysheet_alternateformat_save"):
        raise SpreadsheetError(
            "交替颜色规则暂不能导出，请先转换为单元格颜色", "unsupported_export_rule"
        )
    for item in sheet.celldata:
        value = item.v
        if value.get("tr") not in (None, 0, "0"):
            raise SpreadsheetError("文字旋转暂不能导出为 XLSX", "unsupported_export_style")
        cell = ws.cell(item.r + 1, item.c + 1)
        cell.value = value.get("f") or plain_value(value)
        runs = value.get("ct", {}).get("s")
        if not value.get("f") and isinstance(runs, list) and runs:
            cell.value = CellRichText(
                [
                    TextBlock(
                        InlineFont(
                            rFont=str(run.get("ff") or "Arial"),
                            sz=run.get("fs") or 11,
                            b=bool(run.get("bl")),
                            i=bool(run.get("it")),
                            color=excel_color(run.get("fc") or "#000000"),
                            u="single" if run.get("un") else None,
                            strike=bool(run.get("cl")),
                        ),
                        str(run.get("v", "")),
                    )
                    for run in runs
                ]
            )
        if not value.get("f") and isinstance(cell.value, str):
            cell.data_type = "s"
        cell.number_format = value.get("ct", {}).get("fa", "General")
        font = value.get("ff", "Arial")
        if isinstance(font, (int, float)):
            font = {0: "Times New Roman", 1: "Arial", 2: "Tahoma", 3: "Verdana"}.get(font, "Arial")
        cell.font = Font(
            name=font,
            size=value.get("fs", 11),
            bold=bool(value.get("bl")),
            italic=bool(value.get("it")),
            underline="single" if value.get("un") else None,
            strike=bool(value.get("cl")),
            color=excel_color(value.get("fc") or "#000000"),
        )
        if value.get("bg"):
            cell.fill = PatternFill("solid", fgColor=excel_color(value["bg"]))
        cell.alignment = Alignment(
            horizontal={0: "center", 1: "left", 2: "right"}.get(value.get("ht"), "left"),
            vertical={0: "center", 1: "top", 2: "bottom"}.get(value.get("vt"), "bottom"),
            wrap_text=str(value.get("tb")) == "2",
        )
        if value.get("ps", {}).get("value"):
            cell.comment = Comment(value["ps"]["value"], "FPL")
    for border in sheet.config.get("borderInfo", []):
        if border.get("rangeType") != "cell":
            # FortuneSheet also emits range border rules; expand with bounded coordinates.
            write_range_border(ws, border)
            continue
        item = border["value"]
        sides = {}
        for short, long in (("l", "left"), ("r", "right"), ("t", "top"), ("b", "bottom")):
            side = item.get(short)
            if side:
                sides[long] = Side(
                    style=next(
                        (k for k, v in BORDER_STYLES.items() if v == side.get("style")), "thin"
                    ),
                    color=excel_color(side.get("color") or "#000000"),
                )
        ws.cell(item["row_index"] + 1, item["col_index"] + 1).border = Border(**sides)
    for merge in sheet.config.get("merge", {}).values():
        ws.merge_cells(
            start_row=merge["r"] + 1,
            start_column=merge["c"] + 1,
            end_row=merge["r"] + merge["rs"],
            end_column=merge["c"] + merge["cs"],
        )
    for row, height in sheet.config.get("rowlen", {}).items():
        ws.row_dimensions[int(row) + 1].height = float(height) * 72 / 96
    for col, width in sheet.config.get("columnlen", {}).items():
        ws.column_dimensions[get_column_letter(int(col) + 1)].width = max(0, (float(width) - 5) / 7)
    for row in sheet.config.get("rowhidden", {}):
        ws.row_dimensions[int(row) + 1].hidden = True
    for col in sheet.config.get("colhidden", {}):
        ws.column_dimensions[get_column_letter(int(col) + 1)].hidden = True
    frozen = extra.get("frozen", {})
    if frozen:
        region = frozen.get("range", {})
        kind = frozen.get("type", "rangeBoth")
        ws.freeze_panes = ws.cell(
            1 if kind in {"column", "rangeColumn"} else max(1, region.get("row_focus", 0) + 2),
            1 if kind in {"row", "rangeRow"} else max(1, region.get("column_focus", 0) + 2),
        )
    for position, link in extra.get("hyperlink", {}).items():
        row, column = (int(part) + 1 for part in position.split("_"))
        address = link.get("linkAddress", "")
        if not re.match(r"^(https?://|mailto:|#)", address, re.I):
            raise SpreadsheetError("此超链接类型暂不能导出", "unsupported_export_rule")
        ws.cell(row, column).hyperlink = address
    if extra.get("filter_select"):
        from .exchange_rules import range_text

        ws.auto_filter.ref = range_text(extra["filter_select"])
    ws.sheet_state = "hidden" if extra.get("hide") else "visible"
    write_rules(ws, sheet)


def write_range_border(ws, border):
    kind = border.get("borderType", "border-all")
    if kind not in {
        "border-all",
        "border-outside",
        "border-inside",
        "border-left",
        "border-right",
        "border-top",
        "border-bottom",
        "border-none",
        "border-horizontal",
        "border-vertical",
    }:
        raise SpreadsheetError("边框类型无法导出", "unsupported_export_rule")
    side = Side(
        style=next((k for k, v in BORDER_STYLES.items() if v == border.get("style")), "thin"),
        color=excel_color(border.get("color") or "#000000"),
    )
    for area in border.get("range", []):
        top, bottom = area["row"]
        left, right = area["column"]
        if (bottom - top + 1) * (right - left + 1) > MAX_GRID:
            raise SpreadsheetError("边框范围过大")
        for row in range(top, bottom + 1):
            for col in range(left, right + 1):
                cell = ws.cell(row + 1, col + 1)
                if kind == "border-none":
                    cell.border = Border()
                    continue
                sides = {k: getattr(cell.border, k) for k in ("left", "right", "top", "bottom")}
                edges = {
                    "left": col == left,
                    "right": col == right,
                    "top": row == top,
                    "bottom": row == bottom,
                }
                for name, edge in edges.items():
                    if (
                        kind == "border-all"
                        or kind == f"border-{name}"
                        or (kind == "border-outside" and edge)
                        or (kind == "border-inside" and not edge)
                        or (kind == "border-horizontal" and name in {"top", "bottom"})
                        or (kind == "border-vertical" and name in {"left", "right"})
                    ):
                        sides[name] = side
                cell.border = Border(**sides)
