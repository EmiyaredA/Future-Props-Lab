"""Version 7 archive additions and ID remapping shared by backups and copies."""

from copy import deepcopy
from datetime import datetime

from sqlalchemy import delete, select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtNote
from app.runtime.ids import new_id

from .models import DataAsset, DataChange, DataTable
from .schemas import Snapshot
from .storage import asset_ids, entities, journal, persist, snapshot
from .validation import validate_snapshot


async def export_tables(session, notes):
    result = {}
    for n in notes:
        if n.kind != "multitable":
            continue
        state = await snapshot(session, n.id)
        rows = list(
            await session.scalars(
                select(DataChange).where(DataChange.note_id == n.id).order_by(DataChange.revision)
            )
        )
        result[n.id] = {
            "state": state.model_dump(mode="json"),
            "revision": n.revision,
            "history": [
                {
                    "revision": r.revision,
                    "changes": r.changes,
                    "checkpoint": r.checkpoint,
                    "author_id": r.author_id,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ],
        }
    return result


def archive_assets(data):
    result = set()
    for value in data.values():
        result |= asset_ids(Snapshot.model_validate(value["state"]))
        # Reconstruct each historical state to account for removed attachment fields.
        state = {}
        for row in value.get("history", []):
            if row["checkpoint"]:
                state = entities(Snapshot.model_validate(row["checkpoint"]))
            else:
                for c in row["changes"]:
                    if c["after"] is None:
                        state.pop(c["key"], None)
                    else:
                        state[c["key"]] = c["after"]
            result |= asset_ids(from_entities(state))
    return result


def from_entities(values):
    tables = [v for k, v in values.items() if k.startswith("table:")]
    return Snapshot.model_validate(
        {
            "tables": tables,
            "records": {
                t["id"]: [v for k, v in values.items() if k.startswith("record:" + t["id"] + ":")]
                for t in tables
            },
        }
    )


def validate_archive(payload):
    data = payload.get("multitables", {})
    expected = {n["id"] for n in payload["notes"] if n.get("kind") == "multitable"}
    if not isinstance(data, dict) or set(data) != expected:
        raise ThoughtError("多维表格备份不完整")
    for value in data.values():
        state = Snapshot.model_validate(value["state"])
        validate_snapshot(state)
        history = value.get("history", [])
        revision = -1
        reconstructed = {}
        for row in history:
            if row["revision"] <= revision or row["revision"] > value["revision"]:
                raise ThoughtError("表格历史修订号无效")
            revision = row["revision"]
            if row["checkpoint"]:
                checked = Snapshot.model_validate(row["checkpoint"])
                validate_snapshot(checked)
                reconstructed = entities(checked)
            else:
                for c in row["changes"]:
                    if reconstructed.get(c["key"]) != c["before"]:
                        raise ThoughtError("表格历史链不完整")
                    if c["after"] is None:
                        reconstructed.pop(c["key"], None)
                    else:
                        reconstructed[c["key"]] = c["after"]
                validate_snapshot(from_entities(reconstructed))
        if not history or entities(state) != reconstructed:
            raise ThoughtError("表格历史与当前状态不一致")
    if not archive_assets(data) <= {a["id"] for a in payload["assets"]}:
        raise ThoughtError("备份缺少表格附件")


def entity_mapping(data):
    ids = set()

    def collect(state):
        for t in state.get("tables", []):
            ids.add(t["id"])
            ids.update(f["id"] for f in t["fields"])
            ids.update(v["id"] for v in t["views"])
        ids.update(r["id"] for rows in state.get("records", {}).values() for r in rows)

    for value in data.values():
        collect(value["state"])
        for row in value.get("history", []):
            if row["checkpoint"]:
                collect(row["checkpoint"])
            for c in row["changes"]:
                for v in [c["before"], c["after"]]:
                    if v:
                        ids.add(v["id"])
                        ids.update(f["id"] for f in v.get("fields", []))
                        ids.update(x["id"] for x in v.get("views", []))
    return {id: new_id() for id in ids}


def remap_state(state, mapping, notes, assets):
    value = deepcopy(state)
    for t in value["tables"]:
        old_id = t["id"]
        t["id"] = mapping[old_id]
        for f in t["fields"]:
            f["id"] = mapping[f["id"]]
        for v in t["views"]:
            v["id"] = mapping[v["id"]]
            c = v["config"]
            for k in ["group_field_id", "stack_field_id", "date_field_id"]:
                c[k] = mapping.get(c.get(k))
            for k in ["column_order", "hidden_fields"]:
                c[k] = [mapping[id] for id in c.get(k, [])]
            c["column_widths"] = {
                mapping[id]: width for id, width in c.get("column_widths", {}).items()
            }
            for rule in c.get("filters", []) + c.get("sorts", []):
                field = next(f for f in t["fields"] if f["id"] == mapping[rule["field_id"]])
                if "value" in rule and field["type"] in {"note", "attachment"}:
                    targets = notes if field["type"] == "note" else assets
                    if isinstance(rule["value"], list):
                        rule["value"] = [targets[id] for id in rule["value"] if id in targets]
                    elif isinstance(rule["value"], str):
                        rule["value"] = targets.get(rule["value"], rule["value"])
                rule["field_id"] = mapping[rule["field_id"]]
        rows = value["records"].pop(old_id, [])
        for r in rows:
            r["id"] = mapping[r["id"]]
            r["values"] = {mapping[k]: val for k, val in r["values"].items()}
            for f in t["fields"]:
                if f["type"] in {"attachment", "note"} and r["values"].get(f["id"]):
                    targets = assets if f["type"] == "attachment" else notes
                    r["values"][f["id"]] = [
                        targets[id] for id in r["values"][f["id"]] if id in targets
                    ]
        value["records"][t["id"]] = rows
    return Snapshot.model_validate(value)


def remap_embeds(document, mapping):
    if document.get("type") == "multitableView":
        for key in ("tableId", "viewId"):
            document["attrs"][key] = mapping.get(document["attrs"][key], document["attrs"][key])
    for child in document.get("content", []):
        remap_embeds(child, mapping)


async def import_tables(session, data, notes, assets, mapping):

    for source_id, value in data.items():
        id = notes[source_id]
        await session.execute(delete(DataTable).where(DataTable.note_id == id))
        await session.execute(delete(DataChange).where(DataChange.note_id == id))
        await session.execute(delete(DataAsset).where(DataAsset.note_id == id))
        state = remap_state(value["state"], mapping, notes, assets)
        await persist(session, id, Snapshot(tables=[], records={}), state)
        source_entities, previous = {}, Snapshot(tables=[], records={})
        n = await session.get(ThoughtNote, id)
        for row in value["history"]:
            if row["checkpoint"]:
                source_entities = entities(Snapshot.model_validate(row["checkpoint"]))
            else:
                for c in row["changes"]:
                    if c["after"] is None:
                        source_entities.pop(c["key"], None)
                    else:
                        source_entities[c["key"]] = c["after"]
            current = remap_state(
                from_entities(source_entities).model_dump(mode="json"), mapping, notes, assets
            )
            n.revision = row["revision"]
            await journal(session, n, previous, current, row["author_id"], bool(row["checkpoint"]))
            change = await session.scalar(
                select(DataChange).where(
                    DataChange.note_id == id, DataChange.revision == row["revision"]
                )
            )
            change.created_at = datetime.fromisoformat(row["created_at"])
            previous = current
        n.revision = value["revision"]
