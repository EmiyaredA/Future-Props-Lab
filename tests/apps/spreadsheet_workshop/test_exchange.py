"""File interchange verifies actual bytes, formulas and explicit loss reporting."""

import io
import zipfile
from datetime import datetime

import pytest
from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from studio.apps.spreadsheet_workshop.exchange import export_document, import_document
from studio.apps.spreadsheet_workshop.schemas import (
    Sheet,
    SpreadsheetDocument,
    SpreadsheetError,
    SpreadsheetExport,
)


def xlsx_bytes(workbook):
    stream = io.BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def test_xlsx_roundtrip_cells_formulas_styles_merges_freeze_and_rules():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "销售 数据"
    sheet.append(["名称", "金额", "日期"])
    sheet.append(["00123", 25.5, datetime(2026, 11, 16)])
    sheet["B3"] = "=SUM(B2,10)"
    sheet["A1"].font = Font(name="Arial", bold=True, color="A04020")
    sheet["A1"].fill = PatternFill("solid", fgColor="FFEEDD")
    sheet["B2"].number_format = "0.00"
    sheet.merge_cells("A5:C5")
    sheet["A5"] = "合并标题"
    sheet.freeze_panes = "B2"
    sheet.column_dimensions["B"].width = 20
    sheet.row_dimensions[2].height = 30
    sheet.auto_filter.ref = "A1:C3"
    validation = DataValidation(type="list", formula1='"待办,完成"')
    sheet.add_data_validation(validation)
    validation.add("A2:A3")
    sheet.conditional_formatting.add(
        "B2:B3",
        CellIsRule(
            operator="greaterThan", formula=[20], fill=PatternFill("solid", fgColor="AAFFAA")
        ),
    )
    workbook.create_sheet("汇总")["A1"] = "='销售 数据'!B3"
    document, warnings = import_document(xlsx_bytes(workbook), "销售.xlsx")
    assert warnings == []
    assert document.sheets[0].celldata[3].v["v"] == "00123"
    content, media = export_document(document, SpreadsheetExport(expected_revision=0))
    assert "spreadsheetml" in media
    restored = load_workbook(io.BytesIO(content))
    assert restored.sheetnames == ["销售 数据", "汇总"]
    sheet = restored.worksheets[0]
    assert sheet["B3"].value == "=SUM(B2,10)"
    assert restored["汇总"]["A1"].value == "='销售 数据'!B3"
    assert sheet["A2"].value == "00123"
    assert sheet["C2"].value == datetime(2026, 11, 16)
    assert sheet["A1"].font.bold and sheet["A1"].fill.fgColor.rgb.endswith("FFEEDD")
    assert str(sheet.merged_cells) == "A5:C5"
    assert sheet.freeze_panes == "B2"
    assert sheet.column_dimensions["B"].width == 20
    assert sheet.row_dimensions[2].height == 30
    assert sheet.auto_filter.ref == "A1:C3"
    assert len(sheet.data_validations.dataValidation) == 2
    assert len(sheet.conditional_formatting) == 1
    assert restored.calculation.fullCalcOnLoad and restored.calculation.forceFullCalc
    assert load_workbook(io.BytesIO(content), data_only=True).worksheets[0]["B3"].value is None
    restored.close()


def test_csv_quotes_newlines_bom_leading_zeros_and_literal_formula():
    source = (
        '\ufeff名称,备注,代码,金额\r\n"张,三","第一行\n第二行",00123,12.5\r\n'
        '=SUM(A1),"引号""测试",,\r\n'
    )
    document, warnings = import_document(source.encode(), "表.csv")
    assert not warnings
    cells = {(c.r, c.c): c.v for c in document.sheets[0].celldata}
    assert cells[(1, 0)]["v"] == "张,三"
    assert cells[(1, 1)]["v"] == "第一行\n第二行"
    assert cells[(1, 2)]["v"] == "00123"
    assert cells[(1, 3)]["v"] == 12.5
    assert "f" not in cells[(2, 0)]
    output, _ = export_document(document, SpreadsheetExport(expected_revision=0, format="csv"))
    assert output.startswith(b"\xef\xbb\xbf")
    assert b"'=SUM(A1)" in output
    restored, _ = import_document(output, "again.csv")
    assert restored.sheets[0].celldata[4].v["v"] == "张,三"
    import_document("名称,上海".encode("gb18030"), "旧.csv", "gb18030")


def test_chart_and_unsupported_validation_are_reported():
    workbook = Workbook()
    ws = workbook.active
    ws.append([1, 2])
    chart = BarChart()
    chart.add_data(Reference(ws, min_col=1, max_col=2, min_row=1))
    ws.add_chart(chart, "D1")
    validation = DataValidation(type="custom", formula1="A1>0")
    ws.add_data_validation(validation)
    validation.add("A1")
    _, warnings = import_document(xlsx_bytes(workbook), "chart.xlsx")
    assert any("图表" in warning for warning in warnings)
    assert any("数据校验" in warning for warning in warnings)


def test_reject_zip_traversal_entities_and_oversized_dimensions():
    for name, content in (
        ("../file.xml", b"<x/>"),
        ("xl/workbook.xml", b'<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>'),
    ):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr(name, content)
        with pytest.raises(SpreadsheetError):
            import_document(stream.getvalue(), "bad.xlsx")
    workbook = Workbook()
    workbook.active["XFD1048576"] = 1
    with pytest.raises(SpreadsheetError, match="网格"):
        import_document(xlsx_bytes(workbook), "huge.xlsx")
    for filename in ("old.xls", "macro.xlsm"):
        with pytest.raises(SpreadsheetError, match="XLSX 或 CSV"):
            import_document(b"content", filename)


def test_native_colors_rich_text_hyperlinks_and_column_freeze_export():
    document = SpreadsheetDocument(
        sheets=[
            Sheet(
                id="one",
                name="Sheet1",
                celldata=[
                    {
                        "r": 0,
                        "c": 0,
                        "v": {"v": "链接", "fc": "rgb(0, 0, 255)", "bg": "#abc", "un": 1},
                    },
                    {
                        "r": 1,
                        "c": 0,
                        "v": {
                            "ct": {
                                "t": "inlineStr",
                                "s": [
                                    {"v": "红", "fc": "#ff0000", "bl": 1},
                                    {"v": "蓝", "fc": "rgb(0, 0, 255)"},
                                ],
                            }
                        },
                    },
                ],
                frozen={"type": "column"},
                hyperlink={"0_0": {"linkType": "webpage", "linkAddress": "https://example.com"}},
            )
        ]
    )
    content, _ = export_document(document, SpreadsheetExport(expected_revision=0))
    workbook = load_workbook(io.BytesIO(content), rich_text=True)
    sheet = workbook.active
    assert sheet.freeze_panes == "B1"
    assert sheet["A1"].font.color.rgb.endswith("0000FF") and sheet["A1"].font.u == "single"
    assert sheet["A1"].fill.fgColor.rgb.endswith("aabbcc")
    assert sheet["A1"].hyperlink.target == "https://example.com"
    assert str(sheet["A2"].value) == "红蓝" and sheet["A2"].value[0].font.b
    workbook.close()
    _, warnings = import_document(content, "native.xlsx")
    assert any("混合文字样式" in warning for warning in warnings)


def test_metadata_bounds_and_export_failures_are_explicit():
    from pydantic import ValidationError

    for config in (
        {"rowlen": {"99999": 30}},
        {"merge": {"0_0": {"r": 0, "c": 0, "rs": 1_000_000, "cs": 1}}},
        {"borderInfo": [{"range": [{"row": [0, 99], "column": [0, 25]}]}] * 400},
    ):
        with pytest.raises(ValidationError):
            Sheet(id="one", name="Sheet1", config=config)
    document = SpreadsheetDocument(
        sheets=[
            Sheet(
                id="one",
                name="Sheet1",
                celldata=[{"r": 0, "c": 0, "v": {"v": 1, "fc": "not-a-color"}}],
            )
        ]
    )
    with pytest.raises(SpreadsheetError, match="颜色"):
        export_document(document, SpreadsheetExport(expected_revision=0))
    control_text, _ = import_document(b"value\nembedded\x00character", "control.csv")
    with pytest.raises(SpreadsheetError, match="格式无法导出"):
        export_document(control_text, SpreadsheetExport(expected_revision=0))


def test_xml_cell_count_is_bounded_before_workbook_allocation():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
        archive.writestr(
            "custom/location.XML",
            "<worksheet><sheetData><row>"
            + '<c r="A1"><v>1</v></c>' * 100_001
            + "</row></sheetData></worksheet>",
        )
    with pytest.raises(SpreadsheetError, match="数量超过限制"):
        import_document(stream.getvalue(), "count.xlsx")
