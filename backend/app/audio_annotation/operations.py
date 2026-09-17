from copy import deepcopy

from app.audio_annotation.projects import AudioAnnotationProjects
from app.concurrency.entity_edits import edit, find
from app.concurrency.operation_receipts import OperationError, record, replay
from app.concurrency.revisions import RevisionConflictError
from app.schemas.audio_annotation import AudioAnnotationDocumentOut, AudioAnnotationDocumentPutIn


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


async def apply_operations(session, workspace_id, project_id, body):
    projects = AudioAnnotationProjects(session)
    current = await projects.get_document(project_id)
    key = dict(workspace_id=workspace_id, kind="annotation", resource_id=project_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return AudioAnnotationDocumentOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await projects.put_document(project_id, candidate, commit=False)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return AudioAnnotationDocumentOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
