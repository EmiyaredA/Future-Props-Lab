"""Typed SQLite predicates; no user SQL, global sorting precedes pagination."""

import json

from sqlalchemy import String, and_, case, cast, exists, func, or_, select

from app.apps.thought_workshop.account_directory import profiles
from app.apps.thought_workshop.errors import ThoughtError

from .models import DataRecord
from .schemas import RecordPage, RecordSpec


def person_ids(value):
    if isinstance(value, str):
        return {value}
    if isinstance(value, list):
        return {item for item in value if isinstance(item, str)}
    return set()


async def active_members(session, ids):
    if not ids:
        return {}
    rows = await profiles(session, ids=ids)
    return {row.id: row.display_name.strip() or row.username for row in rows if row.active}


def statement(table, query):
    config = next((v.config for v in table.views if v.id == query.view_id), None)
    if query.view_id and config is None:
        raise ThoughtError("视图不存在", 404, "not_found")
    fields = {f.id: f for f in table.fields}
    predicates = [DataRecord.table_id == table.id]

    def value(id):
        expr = func.json_extract(DataRecord.values, '$."' + id + '"')
        if fields[id].type == "single":
            return case(*[(expr == o.id, o.label) for o in fields[id].options], else_=expr)
        return expr

    if query.search:
        terms = [
            cast(value(f.id), String).contains(query.search, autoescape=True)
            for f in table.fields
            if f.type not in {"note", "attachment"}
        ]
        for field in table.fields:
            if field.type == "multi":
                ids = [o.id for o in field.options if query.search.casefold() in o.label.casefold()]
                if ids:
                    members = func.json_each(
                        DataRecord.values, '$."' + field.id + '"'
                    ).table_valued("value")
                    terms.append(
                        exists(select(1).select_from(members).where(members.c.value.in_(ids)))
                    )
        predicates.append(or_(*terms))

    if config:
        filters = []
        for f in config.filters:
            expr = value(f.field_id)
            arg = f.value
            if fields[f.field_id].type == "single":
                arg = next((o.label for o in fields[f.field_id].options if o.id == arg), arg)
            if isinstance(arg, list):
                arg = json.dumps(arg, ensure_ascii=False, separators=(",", ":"))
            person = fields[f.field_id]
            if f.operator == "contains" and (
                person.type in {"multi", "note", "attachment"}
                or (person.type == "person" and person.config.allow_multiple)
            ):
                members = func.json_each(DataRecord.values, '$."' + f.field_id + '"').table_valued(
                    "value"
                )
                filters.append(exists(select(1).select_from(members).where(members.c.value == arg)))
                continue
            operations = {
                "eq": lambda expr=expr, arg=arg: expr == arg,
                "ne": lambda expr=expr, arg=arg: or_(expr.is_(None), expr != arg),
                "gt": lambda expr=expr, arg=arg: expr > arg,
                "gte": lambda expr=expr, arg=arg: expr >= arg,
                "lt": lambda expr=expr, arg=arg: expr < arg,
                "lte": lambda expr=expr, arg=arg: expr <= arg,
                "contains": lambda expr=expr, arg=arg: cast(expr, String).contains(
                    str(arg or ""), autoescape=True
                ),
                "empty": lambda expr=expr: or_(expr.is_(None), expr == "", expr == "[]"),
                "not_empty": lambda expr=expr: and_(expr.is_not(None), expr != "", expr != "[]"),
            }
            filters.append(operations[f.operator]())
        if filters:
            predicates.append((and_ if config.filter_mode == "all" else or_)(*filters))
    order = []
    if config:
        if config.group_field_id:
            order.append(value(config.group_field_id).asc())
        order.extend(
            value(s.field_id).desc() if s.direction == "desc" else value(s.field_id).asc()
            for s in config.sorts
        )
    order.extend([DataRecord.position.asc(), DataRecord.id.asc()])
    return select(DataRecord).where(*predicates).order_by(*order), predicates, config


async def records(session, table, query, revision, owner_user_id=None):
    stmt, predicates, config = statement(table, query)
    total = await session.scalar(select(func.count()).select_from(DataRecord).where(*predicates))
    rows = list(await session.scalars(stmt.offset(query.offset).limit(query.limit)))
    groups = {}
    if config and config.group_field_id:
        group = func.json_extract(DataRecord.values, '$."' + config.group_field_id + '"')
        groups = {
            str(int(key) if isinstance(key, float) and key.is_integer() else key)
            if key is not None
            else "": count
            for key, count in await session.execute(
                select(group, func.count()).where(*predicates).group_by(group)
            )
        }
    items = [RecordSpec.model_validate(r) for r in rows]
    referenced = set()
    for field in table.fields:
        if field.type != "person":
            continue
        for item in items:
            referenced |= person_ids(item.values.get(field.id))
    people = await active_members(session, referenced) if owner_user_id else {}
    return RecordPage(
        revision=revision,
        items=items,
        total=total or 0,
        groups=groups,
        people=people,
    )
