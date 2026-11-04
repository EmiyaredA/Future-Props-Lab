"""Transform Canvas edit batches without opening the Visual or Assets stores."""

from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.runtime.entity_edits import edit


def transform(current, body):
    data = current.model_dump(mode="json")
    for op in body.operations:
        result = edit(data["nodes" if op.entity == "node" else "edges"], op)
        if op.entity == "node" and op.action == "duplicate":
            result["approved"] = False
        if op.entity == "node" and op.action == "remove":
            data["edges"] = [
                e for e in data["edges"] if op.id not in (e["source_node_id"], e["target_node_id"])
            ]
    return VisualCanvasDocumentPutIn(
        nodes=data["nodes"],
        edges=data["edges"],
        expected_revision=body.expected_revision,
    )
