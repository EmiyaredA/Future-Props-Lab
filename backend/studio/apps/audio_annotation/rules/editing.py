"""Transform a document snapshot without accessing storage or transport."""

from copy import deepcopy

from studio.apps.audio_annotation.schemas.document import AudioAnnotationDocumentPutIn
from studio.runtime.entity_edits import edit, find
from studio.runtime.operation_errors import OperationError


def transform(current, body):
    data = current.model_dump(mode="json")
    for op in body.operations:
        segments = data["segments"]
        if op.action == "split":
            item = find(segments, op.id)
            if min(op.at_ms - item["start_ms"], item["end_ms"] - op.at_ms) < 100:
                raise OperationError("拆分后的片段不能短于 100 毫秒")
            if any(s["id"] == op.new_id for s in segments):
                raise OperationError("新片段 ID 已存在")
            clone = deepcopy(item)
            clone.update(
                id=op.new_id, start_ms=op.at_ms, text="", localized_texts=[], status="draft"
            )
            item.update(end_ms=op.at_ms, status="draft")
            segments.append(clone)
        elif op.action == "merge_next":
            segments.sort(key=lambda item: (item["start_ms"], item["end_ms"], item["id"]))
            item = find(segments, op.id)
            index = segments.index(item)
            if index + 1 >= len(segments):
                raise OperationError("没有可合并的下一片段")
            other = segments.pop(index + 1)
            item.update(
                end_ms=max(item["end_ms"], other["end_ms"]),
                text="\n".join(t.strip() for t in (item["text"], other["text"]) if t.strip()),
                localized_texts=[],
                status="draft",
            )
        else:
            items = data["speakers"] if op.entity == "speaker" else segments
            edit(items, op)
            if op.entity == "speaker" and op.action == "remove":
                for item in segments:
                    item["speaker_ids"] = [s for s in item["speaker_ids"] if s != op.id]
                    item["speaker_id"] = next(iter(item["speaker_ids"]), None)
            if op.entity == "segment" and op.action == "update" and "speaker_ids" in op.value:
                item = find(segments, op.id)
                item["speaker_id"] = next(iter(item["speaker_ids"]), None)
        segments.sort(key=lambda item: (item["start_ms"], item["end_ms"], item["id"]))
    return AudioAnnotationDocumentPutIn(
        speakers=data["speakers"],
        custom_emotions=data.get("custom_emotions") or [],
        segments=data["segments"],
        expected_revision=body.expected_revision,
        schema_version=current.schema_version,
    )
