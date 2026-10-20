"""Local construction helpers never perform writes or retain live resource versions."""

from copy import deepcopy
from uuid import uuid4


def edit_batch(expected_revision: int, *operations: dict, request_id: str | None = None) -> dict:
    return {
        "expected_revision": expected_revision,
        "request_id": request_id or str(uuid4()),
        "operations": deepcopy(list(operations)),
    }


def entity_edit(
    entity: str,
    action: str,
    id: str,
    *,
    value: dict | None = None,
    parent_id: str | None = None,
    index: int | None = None,
) -> dict:
    result = {"entity": entity, "action": action, "id": id, "value": deepcopy(value or {})}
    if parent_id is not None:
        result["parent_id"] = parent_id
    if index is not None:
        result["index"] = index
    return result


def text_node(text: str, *, id: str | None = None, title="文本", x=0, y=0) -> dict:
    return {
        "id": id or str(uuid4()),
        "kind": "text",
        "title": title,
        "text": text,
        "position": {"x": x, "y": y},
    }


def note_document(*paragraphs: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}] if text else []}
            for text in paragraphs or ("",)
        ],
    }


def presentation_document(*slides: dict) -> dict:
    return {
        "version": 3,
        "width": 1280,
        "height": 720,
        "slides": deepcopy(list(slides))
        or [
            {"id": str(uuid4()), "background": "#ffffff", "notes": "", "elements": []},
        ],
    }
