"""Bounded visible-cell projection; formulas are never evaluated by the preview."""

import re

from studio.runtime.project_preview import PreviewCell, ProjectPreview, preview_version


def color(value):
    return (
        value
        if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{3,8}|rgba?\([\d., %]+\)", value)
        else None
    )


def workbook_preview(document, revision):
    for sheet in sorted(document.get("sheets", []), key=lambda item: item.get("order", 0)):
        if sheet.get("hide"):
            continue
        cells = [
            cell
            for cell in sheet.get("celldata", [])
            if cell.get("v", {}).get("m", cell.get("v", {}).get("v")) not in (None, "")
        ]
        if not cells:
            continue
        top, left = min((cell["r"], cell["c"]) for cell in cells)
        visible = {
            (cell["r"], cell["c"]): cell["v"]
            for cell in cells
            if top <= cell["r"] < top + 6 and left <= cell["c"] < left + 5
        }
        height = min(6, max(r for r, c in visible) - top + 1) if visible else 1
        width = min(5, max(c for r, c in visible) - left + 1) if visible else 1
        rows = []
        for r in range(top, top + height):
            row = []
            for c in range(left, left + width):
                value = visible.get((r, c), {})
                row.append(
                    PreviewCell(
                        text=str(value.get("m", value.get("v", "")))[:120],
                        color=color(value.get("fc")),
                        background=color(value.get("bg")),
                        bold=bool(value.get("bl")),
                    )
                )
            rows.append(row)
        return ProjectPreview(
            kind="table",
            version=preview_version(revision, rows),
            label=sheet["name"][:160],
            cells=rows,
        )
    return None


async def workbook_previews(session, owner, identities):
    """SQLite projects at most 30 cells per workbook; full JSON never enters the list process."""
    from sqlalchemy import func, select, true

    from .storage.models import SpreadsheetWorkbook

    if not identities:
        return {}
    book = SpreadsheetWorkbook
    sheets = func.json_each(book.document["sheets"]).table_valued("key", "value").alias("sheets")
    cells = (
        func.json_each(func.json_extract(sheets.c.value, "$.celldata"))
        .table_valued("value")
        .alias("cells")
    )
    row = func.json_extract(cells.c.value, "$.r")
    column = func.json_extract(cells.c.value, "$.c")
    partition = (book.id, sheets.c.key)
    selected = (
        select(
            book.id.label("project"),
            book.revision,
            func.json_extract(sheets.c.value, "$.name").label("name"),
            row.label("r"),
            column.label("c"),
            func.json_extract(cells.c.value, "$.v").label("value"),
            func.min(row).over(partition_by=partition).label("top"),
            func.first_value(column)
            .over(partition_by=partition, order_by=(row, column))
            .label("left"),
            func.dense_rank()
            .over(
                partition_by=book.id,
                order_by=(func.json_extract(sheets.c.value, "$.order"), sheets.c.key),
            )
            .label("sheet"),
        )
        .select_from(book)
        .join(sheets, true())
        .join(cells, true())
        .where(
            book.owner_user_id == owner,
            book.id.in_(identities),
            func.coalesce(func.json_extract(sheets.c.value, "$.hide"), 0) == 0,
            func.coalesce(
                func.json_extract(cells.c.value, "$.v.m"),
                func.json_extract(cells.c.value, "$.v.v"),
                "",
            )
            != "",
        )
        .subquery()
    )
    result = await session.execute(
        select(selected)
        .where(
            selected.c.sheet == 1,
            selected.c.r < selected.c.top + 6,
            selected.c.c < selected.c.left + 5,
        )
        .order_by(selected.c.project, selected.c.r, selected.c.c)
    )
    documents, revisions = {}, {}
    import json

    for item in result:
        revisions[item.project] = item.revision
        sheet = documents.setdefault(
            item.project, {"sheets": [{"name": item.name, "celldata": []}]}
        )["sheets"][0]
        sheet["celldata"].append({"r": item.r, "c": item.c, "v": json.loads(item.value)})
    return {
        identity: workbook_preview(document, revisions[identity])
        for identity, document in documents.items()
    }
