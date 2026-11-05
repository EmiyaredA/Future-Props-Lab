"""Editable PowerPoint tables and charts; independent of editor state."""

from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.text import PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt


def px(value):
    return Emu(round(value * 9525))


def table_shape(slide, element, bounds):
    data = element.table
    rows, columns = len(data.rows), len(data.column_widths)
    shape = slide.shapes.add_table(rows, columns, *bounds)
    table = shape.table
    total = sum(data.column_widths)
    for column, width in zip(table.columns, data.column_widths, strict=True):
        column.width = px(element.width * width / total)
    for r, row in enumerate(data.rows):
        for c, cell in enumerate(row):
            if cell.covered:
                continue
            target = table.cell(r, c)
            if cell.row_span > 1 or cell.col_span > 1:
                target.merge(table.cell(r + cell.row_span - 1, c + cell.col_span - 1))
            target.text = cell.text
            target.fill.solid()
            target.fill.fore_color.rgb = RGBColor.from_string(cell.fill[1:])
            target.margin_left = target.margin_right = px(8)
            target.margin_top = target.margin_bottom = px(6)
            properties = target._tc.get_or_add_tcPr()
            for edge in ("lnL", "lnR", "lnT", "lnB"):
                line = OxmlElement(f"a:{edge}")
                line.set("w", str(px(data.border_width)))
                fill = OxmlElement("a:solidFill")
                color = OxmlElement("a:srgbClr")
                color.set("val", data.border_color[1:])
                fill.append(color)
                line.append(fill)
                properties.append(line)
            for paragraph in target.text_frame.paragraphs:
                paragraph.alignment = {
                    "left": PP_ALIGN.LEFT,
                    "center": PP_ALIGN.CENTER,
                    "right": PP_ALIGN.RIGHT,
                }[cell.align]
                for run in paragraph.runs:
                    run.font.name = "Microsoft YaHei"
                    run.font.size = Pt(data.font_size * 0.75)
                    run.font.color.rgb = RGBColor.from_string(cell.color[1:])
                    run.font.bold, run.font.italic, run.font.underline = (
                        cell.bold,
                        cell.italic,
                        cell.underline,
                    )
                    if cell.strike:
                        run._r.get_or_add_rPr().set("strike", "sngStrike")
    return shape


def chart_shape(slide, element, bounds):
    chart = element.chart
    types = {
        "column": XL_CHART_TYPE.COLUMN_STACKED if chart.stacked else XL_CHART_TYPE.COLUMN_CLUSTERED,
        "bar": XL_CHART_TYPE.BAR_STACKED if chart.stacked else XL_CHART_TYPE.BAR_CLUSTERED,
        "line": XL_CHART_TYPE.LINE_STACKED if chart.stacked else XL_CHART_TYPE.LINE,
        "area": XL_CHART_TYPE.AREA_STACKED if chart.stacked else XL_CHART_TYPE.AREA,
        "scatter": XL_CHART_TYPE.XY_SCATTER,
        "pie": XL_CHART_TYPE.PIE,
        "ring": XL_CHART_TYPE.DOUGHNUT,
        "radar": XL_CHART_TYPE.RADAR,
    }
    data = XyChartData() if chart.type == "scatter" else CategoryChartData()
    if chart.type != "scatter":
        data.categories = chart.categories
    for series in chart.series:
        if chart.type == "scatter":
            target = data.add_series(series.name)
            for x, y in zip(chart.categories, series.values, strict=True):
                target.add_data_point(float(x), y)
        else:
            data.add_series(series.name, series.values)
    shape = slide.shapes.add_chart(types[chart.type], *bounds, data)
    native = shape.chart
    native.has_legend = True
    native.legend.position = XL_LEGEND_POSITION.BOTTOM
    native.legend.include_in_layout = False
    for i, series in enumerate(native.series):
        color = RGBColor.from_string(chart.colors[i % len(chart.colors)][1:])
        if chart.type in {"line", "area", "radar", "scatter"}:
            series.format.line.color.rgb = color
        if chart.type not in {"pie", "ring", "line", "radar", "scatter"}:
            series.format.fill.solid()
            series.format.fill.fore_color.rgb = color
        if chart.type in {"pie", "ring"}:
            for index, point in enumerate(series.points):
                point.format.fill.solid()
                point.format.fill.fore_color.rgb = RGBColor.from_string(
                    chart.colors[index % len(chart.colors)][1:]
                )
        if chart.type == "line":
            series.smooth = chart.smooth
    return shape
