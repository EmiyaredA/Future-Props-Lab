"""Workbook commands share the browser and automation persistence boundary."""

import asyncio

from studio.runtime.tasks.blocking_io import run_blocking_io

from .exchange import export_document
from .ports import WorkbookRecords
from .rules import bounds, find_sheet
from .schemas import SpreadsheetError, SpreadsheetRange, SpreadsheetRangeCell


class Workbooks:
    def __init__(self, records: WorkbookRecords):
        self.records = records
        self.conversions = asyncio.Semaphore(2)

    async def preview(self, owner, filename, content, encoding):
        async with self.conversions:
            return await self.records.preview(owner, filename, content, encoding)

    async def read_range(self, owner, identity, sheet_id, address):
        project = await self.records.get(owner, identity)
        sheet = find_sheet(project.document, sheet_id)
        top, left, bottom, right = bounds(address)
        cells = {(cell.r, cell.c): cell.v for cell in sheet.celldata}
        result = []
        for row in range(top, bottom + 1):
            for column in range(left, right + 1):
                cell = cells.get((row, column), {})
                result.append(
                    SpreadsheetRangeCell(
                        row=row,
                        column=column,
                        value=cell.get("v"),
                        formula=cell.get("f"),
                        calculation=project.calculation if cell.get("f") else "not_needed",
                    )
                )
        return SpreadsheetRange(
            revision=project.revision, sheet_id=sheet_id, range=address, cells=result
        )

    async def export(self, owner, identity, body):
        project = await self.records.get(owner, identity)
        if project.revision != body.expected_revision:
            from studio.runtime.revisions import RevisionConflictError

            raise RevisionConflictError(
                body.expected_revision, project.revision, project.model_dump(mode="json")
            )
        if (
            body.format == "csv"
            and body.value_mode == "values"
            and project.calculation == "pending"
        ):
            raise SpreadsheetError(
                "公式尚未重算，请先在浏览器打开，或选择导出公式文本",
                "formula_calculation_pending",
                409,
            )
        async with self.conversions:
            return await run_blocking_io(export_document, project.document, body)
