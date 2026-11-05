"""CSV parsing happens before the use case starts its short write transaction."""

import csv
import io

from sqlalchemy import func, select

from app.apps.thought_workshop.errors import ThoughtError
from app.runtime.ids import new_id

from .models import DataRecord
from .query import statement
from .schemas import BatchIn, CsvPreview, RecordSpec
from .use_cases import Multitable
from .validation import cell, validate_table


def parse(source):
    try:
        rows = list(csv.reader(io.StringIO(source.csv.lstrip("\ufeff")), strict=True))
    except csv.Error as exc:
        raise ThoughtError(f"CSV 格式无效：{exc}", 422, "invalid_csv") from None
    headers = rows.pop(0) if source.header and rows else []
    if len(rows) > 5000 or len(headers) > 50 or any(len(row) > 50 for row in rows):
        raise ThoughtError("CSV 超过 5,000 行或 50 列", 422, "capacity")
    return headers, rows


def preview(source):
    headers, rows = parse(source)
    errors = []
    if source.table is not None and source.mapping is not None:
        validate_table(source.table)
        fields = {f.id: f for f in source.table.fields}
        used = [id for id in source.mapping if id]
        if len(used) != len(set(used)) or not set(used) <= fields.keys():
            raise ThoughtError("字段映射无效", 422, "invalid_csv")
        for i, row in enumerate(rows):
            if len(row) != len(source.mapping):
                errors.append(
                    {"row": i + 1 + int(source.header), "column": None, "message": "列数不匹配"}
                )
                continue
            for j, value in enumerate(row):
                if field_id := source.mapping[j]:
                    try:
                        cell(fields[field_id], value, convert=True)
                    except ThoughtError as exc:
                        errors.append(
                            {
                                "row": i + 1 + int(source.header),
                                "column": j + 1,
                                "message": str(exc),
                            }
                        )
            if len(errors) >= 200:
                break
    return CsvPreview(headers=headers, rows=rows[:20], total=len(rows), errors=errors[:200])


async def import_csv(
    use_case: Multitable, note_id, table_id, body, *, before_write=None, after_write=None
):
    table = body.table or (await use_case.table(note_id, table_id))[0]
    if table.id != table_id:
        raise ThoughtError("CSV 数据表 ID 不匹配", 422, "invalid_csv")
    fields = {f.id: f for f in table.fields}
    if any(id and id not in fields for id in body.mapping) or len(
        [id for id in body.mapping if id]
    ) != len(set(id for id in body.mapping if id)):
        raise ThoughtError("字段映射无效", 422, "invalid_csv")
    _, rows = parse(body)
    start = await use_case.session.scalar(
        select(func.max(DataRecord.position)).where(DataRecord.table_id == table_id)
    )
    records = []
    for i, row in enumerate(rows):
        if len(row) != len(body.mapping):
            raise ThoughtError(
                f"CSV 第 {i + 1 + int(body.header)} 行列数不匹配", 422, "invalid_csv"
            )
        values = {}
        for j, value in enumerate(row):
            if field_id := body.mapping[j]:
                try:
                    values[field_id] = cell(fields[field_id], value, convert=True)
                except ThoughtError as exc:
                    raise ThoughtError(
                        f"CSV 第 {i + 1 + int(body.header)} 行、第 {j + 1} 列：{exc}",
                        422,
                        "invalid_csv",
                    ) from None
        records.append(
            RecordSpec(
                id=new_id(), position=(start if start is not None else -1) + i + 1, values=values
            )
        )
    operations = [{"op": "table.put", "table": table.model_dump()}] if body.table else []
    if records:
        operations.append(
            {
                "op": "records.put",
                "table_id": table.id,
                "records": [r.model_dump() for r in records],
            }
        )
    if not operations:
        raise ThoughtError("CSV 没有数据", 422, "invalid_csv")
    return await use_case.apply(
        note_id,
        BatchIn(expected_revision=body.expected_revision, operations=operations),
        checkpoint=True,
        before_write=before_write,
        after_write=after_write,
    )


async def export_csv(use_case, note_id, table_id, query):
    table, _ = await use_case.table(note_id, table_id)
    stmt, _, _ = statement(table, query)
    rows = list(await use_case.session.scalars(stmt))
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    fields = sorted(table.fields, key=lambda f: (f.position, f.id))
    writer.writerow([f.name for f in fields])

    def display(field, value):
        if value is None:
            return ""
        if field.type in {"single", "multi"}:
            options = {o.id: o.label for o in field.options}
            value = (
                ";".join(options.get(v, v) for v in value)
                if isinstance(value, list)
                else options.get(value, value)
            )
        if isinstance(value, list):
            value = ";".join(value)
        if isinstance(value, bool):
            value = "true" if value else "false"
        # CSV is data, not spreadsheet executable formulas.
        text = str(value)
        return (
            "'" + text
            if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@"))
            else text
        )

    writer.writerows([[display(f, r.values.get(f.id)) for f in fields] for r in rows])
    return "\ufeff" + out.getvalue()
