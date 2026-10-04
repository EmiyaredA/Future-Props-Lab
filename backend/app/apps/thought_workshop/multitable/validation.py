"""Pure field conversion and consistent record/view validation."""

import math
from datetime import date
from urllib.parse import urlsplit

from app.apps.thought_workshop.errors import ThoughtError

from .schemas import Snapshot


def cell(field, value, *, convert=False):
    if value is None or value == "":
        return None
    kind = field.type
    if kind == "text":
        if convert and isinstance(value, (bool, int, float)):
            value = str(value)
        if isinstance(value, str) and len(value) <= 10000:
            return value
    elif kind == "number":
        if convert and isinstance(value, str):
            try:
                value = float(value)
            except ValueError:
                pass
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            return value
    elif kind == "checkbox":
        if convert and isinstance(value, str) and value.lower() in {"true", "false", "1", "0"}:
            value = value.lower() in {"true", "1"}
        if isinstance(value, bool):
            return value
    elif kind == "date":
        if isinstance(value, str) and len(value) == 10:
            try:
                if date.fromisoformat(value).isoformat() == value:
                    return value
            except ValueError:
                pass
    elif kind == "url":
        if isinstance(value, str) and len(value) <= 8192 and not any(ord(c) < 32 for c in value):
            try:
                parsed = urlsplit(value)
                if parsed.scheme.lower() == "mailto" or (
                    parsed.scheme.lower() in {"http", "https"} and parsed.hostname
                ):
                    return value
            except ValueError:
                pass
    elif kind in {"single", "multi"}:
        options = {o.id: o.label for o in field.options}
        if convert and isinstance(value, str) and value not in options:
            value = next((id for id, label in options.items() if label == value), value)
        if kind == "single" and isinstance(value, str) and value in options:
            return value
        if kind == "multi":
            if convert and isinstance(value, str):
                labels = [v.strip() for v in value.split(";") if v.strip()]
                value = [
                    next((id for id, label in options.items() if label == v), v) for v in labels
                ]
            if isinstance(value, list) and all(isinstance(v, str) and v in options for v in value):
                return list(dict.fromkeys(value))
    elif kind in {"attachment", "note"}:
        if convert and isinstance(value, str):
            value = [v.strip() for v in value.split(";") if v.strip()]
        if (
            isinstance(value, list)
            and len(value) <= 100
            and all(isinstance(v, str) and 0 < len(v) <= 36 for v in value)
        ):
            return list(dict.fromkeys(value))
    raise ThoughtError(f"字段「{field.name}」的值不符合 {kind} 类型", 422, "invalid_cell")


def validate_table(table, previous=None):
    field_ids = {f.id for f in table.fields}
    if len(field_ids) != len(table.fields) or len({v.id for v in table.views}) != len(table.views):
        raise ThoughtError("字段或视图 ID 重复", 422, "invalid_table")
    primary = min(table.fields, key=lambda f: (f.position, f.id))
    if primary.type != "text":
        raise ThoughtError("名称字段必须为文本", 422, "invalid_table")
    if previous and min(previous.fields, key=lambda f: (f.position, f.id)).id != primary.id:
        raise ThoughtError("名称字段不能删除或移出第一列", 422, "invalid_table")
    for f in table.fields:
        config = f.config.model_dump()
        allowed = (
            {"date_format"}
            if f.type == "date"
            else ({"decimal_places", "use_grouping"} if f.type == "number" else set())
        )
        if not config.keys() <= allowed:
            raise ThoughtError(f"字段「{f.name}」的配置不符合类型", 422, "invalid_field_config")
        if len({o.id for o in f.options}) != len(f.options):
            raise ThoughtError("选项 ID 重复", 422, "invalid_table")
        if f.type not in {"single", "multi"} and f.options:
            raise ThoughtError("只有选择字段支持选项", 422, "invalid_table")
    fields = {f.id: f for f in table.fields}
    for v in table.views:
        c = v.config
        refs = (
            set(c.column_order + c.hidden_fields + list(c.column_widths))
            | {s.field_id for s in c.sorts}
            | {f.field_id for f in c.filters}
            | {x for x in [c.group_field_id, c.stack_field_id, c.date_field_id] if x}
        )
        if not refs <= field_ids or any(w < 80 or w > 800 for w in c.column_widths.values()):
            raise ThoughtError("视图引用无效字段或列宽", 422, "invalid_view")
        if v.type == "kanban" and (
            not c.stack_field_id or fields[c.stack_field_id].type != "single"
        ):
            raise ThoughtError("看板需要单选字段", 422, "invalid_view")
        if v.type == "calendar" and (not c.date_field_id or fields[c.date_field_id].type != "date"):
            raise ThoughtError("日历需要日期字段", 422, "invalid_view")
        for f in c.filters:
            kind = fields[f.field_id].type
            if f.operator in {"gt", "gte", "lt", "lte"} and kind not in {"number", "date"}:
                raise ThoughtError("此字段不支持大小比较", 422, "invalid_filter")
            if f.operator in {"gt", "gte", "lt", "lte"} and f.value in (None, ""):
                raise ThoughtError("大小比较需要有效值", 422, "invalid_filter")
            if f.operator == "contains" and kind not in {
                "text",
                "url",
                "single",
                "multi",
                "note",
                "attachment",
            }:
                raise ThoughtError("此字段不支持包含筛选", 422, "invalid_filter")
            if f.operator not in {"empty", "not_empty", "contains"}:
                f.value = cell(fields[f.field_id], f.value)
            elif f.operator == "contains" and not isinstance(f.value, str):
                raise ThoughtError("包含筛选需要文字或一个选项 ID", 422, "invalid_filter")
            elif f.operator == "contains" and kind in {"single", "multi"}:
                if f.value not in {o.id for o in fields[f.field_id].options}:
                    raise ThoughtError(
                        "筛选引用的选项不存在，请先修改视图条件", 422, "invalid_filter"
                    )


def convert_records(table, records, old_table=None):
    old = {f.id: f for f in old_table.fields} if old_table else {}
    removed_options = {}
    field_ids = {f.id for f in table.fields}
    for f in table.fields:
        previous = old.get(f.id)
        if previous and previous.type == f.type and f.type in {"single", "multi"}:
            retained = {o.id for o in f.options}
            removed_options[f.id] = {
                o.id: o.label for o in previous.options if o.id not in retained
            }
    errors = []
    for r in records:
        for f in table.fields:
            try:
                if f.id in r.values:
                    previous = old.get(f.id)
                    removed = removed_options.get(f.id)
                    if removed:
                        selected = r.values[f.id] if f.type == "multi" else [r.values[f.id]]
                        for option_id in selected or []:
                            if option_id in removed:
                                raise ThoughtError(
                                    f"选项「{removed[option_id]}」仍被记录引用，请先修改对应记录",
                                    422,
                                    "referenced_option",
                                )
                    r.values[f.id] = cell(
                        f, r.values[f.id], convert=previous is None or previous.type != f.type
                    )
            except ThoughtError as exc:
                errors.append({"record_id": r.id, "field_id": f.id, "message": str(exc)})
        r.values = {k: v for k, v in r.values.items() if k in field_ids}
    return errors


def validate_snapshot(state: Snapshot):
    if not 1 <= len(state.tables) <= 30 or len({t.id for t in state.tables}) != len(state.tables):
        raise ThoughtError("文档需要 1–30 张数据表", 422, "capacity")
    all_ids = []
    for t in state.tables:
        validate_table(t)
        all_ids.extend([t.id, *[f.id for f in t.fields], *[v.id for v in t.views]])
        rows = state.records.get(t.id, [])
        if len(rows) > 5000:
            raise ThoughtError("每张表最多 5,000 条记录", 422, "capacity")
        for r in rows:
            all_ids.append(r.id)
            if not set(r.values) <= {f.id for f in t.fields}:
                raise ThoughtError("记录引用未知字段", 422, "invalid_cell")
            for f in t.fields:
                if f.id in r.values:
                    r.values[f.id] = cell(f, r.values[f.id])
    if len(all_ids) != len(set(all_ids)):
        raise ThoughtError("表格实体 ID 重复", 422, "invalid_table")
