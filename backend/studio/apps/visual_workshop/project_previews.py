"""Select only the current results of nodes still present in an owned canvas."""

from sqlalchemy import or_, select

from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualWorkshopProject
from studio.runtime.project_preview import ProjectPreview, preview_version, thumbnail_url


async def project_previews(session, owner, identities):
    if not identities:
        return {}
    canvases = (
        await session.execute(
            select(
                VisualCanvasDocument.project_id,
                VisualCanvasDocument.nodes,
                VisualCanvasDocument.revision,
            )
            .join(VisualWorkshopProject)
            .where(
                VisualWorkshopProject.owner_user_id == owner,
                VisualCanvasDocument.project_id.in_(identities),
            )
        )
    ).all()
    current = [
        node.get("final_output_id")
        for canvas in canvases
        for node in canvas.nodes
        if node.get("final_output_id")
    ]
    outputs = (
        await session.execute(
            select(
                VisualNodeOutput.project_id,
                VisualNodeOutput.node_id,
                VisualNodeOutput.id,
                VisualNodeOutput.asset_id,
                VisualNodeOutput.kind,
                VisualNodeOutput.is_final,
            )
            .join(VisualWorkshopProject)
            .where(
                VisualWorkshopProject.owner_user_id == owner,
                VisualNodeOutput.project_id.in_(identities),
                or_(VisualNodeOutput.is_final.is_(True), VisualNodeOutput.id.in_(current)),
            )
            .order_by(VisualNodeOutput.created_at.desc(), VisualNodeOutput.id.desc())
        )
    ).all()
    by_project = {}
    for output in outputs:
        by_project.setdefault(output.project_id, []).append(output)
    result = {}
    for canvas in canvases:
        nodes = {node["id"]: node for node in canvas.nodes}
        urls = []
        text = next(
            (n.get("text", "") for n in canvas.nodes if n.get("kind") == "text" and n.get("text")),
            "",
        )[:400]
        for output in by_project.get(canvas.project_id, []):
            node = nodes.get(output.node_id)
            if not node or output.kind not in {"image", "video"} or not output.asset_id:
                continue
            chosen = node.get("final_output_id")
            if (chosen and chosen != output.id) or (not chosen and not output.is_final):
                continue
            url = thumbnail_url(output.asset_id)
            if url not in urls:
                urls.append(url)
        for node in reversed(canvas.nodes):
            if (
                node.get("kind") in {"image", "video"}
                and node.get("asset_id")
                and not node.get("final_output_id")
            ):
                url = thumbnail_url(node["asset_id"])
                if url not in urls:
                    urls.append(url)
        result[canvas.project_id] = ProjectPreview(
            kind="image" if urls else "text" if text else "empty",
            version=preview_version(canvas.revision, urls[:4], text),
            urls=urls[:4],
            text=text,
        )
    return result
