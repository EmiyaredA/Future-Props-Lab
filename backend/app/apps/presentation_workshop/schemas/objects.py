"""Typed content for native tables, charts, formulae and managed media."""

from typing import Literal

from pydantic import Field, model_validator

from app.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel


class PresentationCell(SlideModel):
    text: str = Field(default="", max_length=20000)
    fill: Color = "#FFFFFF"
    color: Color = "#17334A"
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    align: Literal["left", "center", "right"] = "left"
    row_span: int = Field(default=1, ge=1, le=100)
    col_span: int = Field(default=1, ge=1, le=30)
    covered: bool = False


class PresentationTable(SlideModel):
    rows: list[list[PresentationCell]] = Field(min_length=1, max_length=100)
    column_widths: list[float] = Field(min_length=1, max_length=30)
    font_size: float = Field(default=20, ge=6, le=240)
    border_color: Color = "#CDD5DE"
    border_width: float = Field(default=1, ge=0, le=10)

    @model_validator(mode="after")
    def rectangular(self):
        columns = len(self.column_widths)
        if any(width <= 0 or width > 10000 for width in self.column_widths):
            raise ValueError("表格列宽必须为正数且不超过 10000")
        if any(len(row) != columns for row in self.rows):
            raise ValueError("表格每行必须拥有相同列数")
        covered = set()
        for r, row in enumerate(self.rows):
            for c, cell in enumerate(row):
                if (r, c) in covered:
                    if not cell.covered or cell.row_span != 1 or cell.col_span != 1:
                        raise ValueError("合并区域内的单元格必须标为覆盖且不能再次合并")
                    continue
                if (
                    cell.covered
                    or r + cell.row_span > len(self.rows)
                    or c + cell.col_span > columns
                ):
                    raise ValueError("表格合并区域无效或超出边界")
                for rr in range(r, r + cell.row_span):
                    for cc in range(c, c + cell.col_span):
                        if (rr, cc) == (r, c):
                            continue
                        if (rr, cc) in covered:
                            raise ValueError("表格合并区域不能交叠")
                        covered.add((rr, cc))
        return self


class PresentationSeries(SlideModel):
    name: str = Field(max_length=120)
    values: list[float] = Field(min_length=1, max_length=200)


class PresentationChart(SlideModel):
    type: Literal["column", "bar", "line", "area", "scatter", "pie", "ring", "radar"]
    categories: list[str] = Field(min_length=1, max_length=200)
    series: list[PresentationSeries] = Field(min_length=1, max_length=20)
    colors: list[Color] = Field(
        default=["#5474E5", "#18A999", "#F0AD4E"], min_length=1, max_length=20
    )
    stacked: bool = False
    smooth: bool = False
    axis_color: Color = "#56677A"
    grid_color: Color = "#DDE4EB"

    @model_validator(mode="after")
    def data_matches(self):
        if any(len(item.values) != len(self.categories) for item in self.series):
            raise ValueError("图表每个系列的数据数量必须与分类一致")
        if any(len(label) > 200 for label in self.categories):
            raise ValueError("图表分类名称不能超过 200 字符")
        if self.type == "scatter":
            import math

            try:
                if not all(math.isfinite(float(value)) for value in self.categories):
                    raise ValueError
            except ValueError:
                raise ValueError("散点图分类必须为有限的 X 坐标") from None
        return self


class PresentationFormula(SlideModel):
    latex: str = Field(min_length=1, max_length=20000)
    color: Color = "#17334A"
    size: float = Field(default=36, ge=6, le=240)


class PresentationMedia(SlideModel):
    poster_asset_id: Identifier | None = None
    autoplay: bool = False
    loop: bool = False
    icon_color: Color = "#5474E5"
