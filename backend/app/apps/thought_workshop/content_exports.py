import asyncio
import html
import shutil
import tempfile
import zipfile
from pathlib import Path

import mistune
from sqlalchemy import select

from app.apps.thought_workshop.canvas_export import CanvasHtmlRenderer, canvas_sources
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.markdown_conversion import markdown, parse_markdown
from app.apps.thought_workshop.multitable.content import project
from app.apps.thought_workshop.notes import Notes, note_out
from app.apps.thought_workshop.schemas.conversion import ThoughtMarkdownOut
from app.apps.thought_workshop.schemas.document import file_ids
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings
from app.runtime.revisions import RevisionConflictError


async def resolve_assets(session, workspace_id, ids):
    rows = list(
        await session.scalars(
            select(VisualAsset).where(
                VisualAsset.id.in_(ids),
                VisualAsset.workspace_id == workspace_id,
                VisualAsset.project_id.is_(None),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
            )
        )
    )
    if {row.id for row in rows} != set(ids):
        raise ThoughtError("素材不存在或不属于当前公共文件库", 404, "not_found")
    return {row.id: row for row in rows}


async def convert(session, workspace_id, body):
    rows = await resolve_assets(session, workspace_id, set(body.assets.values()))
    document, warnings = parse_markdown(
        body.markdown, {path: rows[id] for path, id in body.assets.items()}
    )
    return ThoughtMarkdownOut(document=document, warnings=warnings)


async def export_note(session, workspace_id, note_id, expected_revision, format):
    note = await Notes(session, workspace_id).get(note_id)
    if note.revision != expected_revision:
        raise RevisionConflictError(
            expected_revision, note.revision, note_out(note).model_dump(mode="json")
        )
    assets = await resolve_assets(session, workspace_id, file_ids(note.document))
    storage = AssetStorage(get_settings())
    files = {
        id: (storage.path_for(row), "assets/" + id + Path(row.original_filename).suffix.lower())
        for id, row in assets.items()
    }
    title, document = note.title, await project(session, workspace_id, note)
    await session.rollback()
    content = (
        "# " + title + "\n\n" + markdown(document, {id: item[1] for id, item in files.items()})
    )
    if format == "html":
        # Canvas nodes are inert SVG. Mermaid retains the established escaped-source
        # server export; the Web exporter supplies its rendered offline SVG version.
        render = mistune.create_markdown(
            renderer=CanvasHtmlRenderer(
                canvas_sources(document, {id: item[1] for id, item in files.items()})
            ),
            plugins=["table", "strikethrough", "task_lists"],
        )
        content = (
            '<!doctype html><html lang="zh"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width"><title>'
            + html.escape(title)
            + "</title><style>body{max-width:1000px;margin:24px auto;padding:0 16px;"
            + "font-family:system-ui,sans-serif}.fpl-canvas{margin:24px 0;overflow:auto}"
            + ".fpl-canvas svg{width:100%;min-width:320px;background:#fff}"
            + "pre{overflow:auto}img{max-width:100%}</style><body>"
            + render(content)
            + "</body></html>"
        )
    directory = Path(tempfile.mkdtemp(prefix="thought-export-"))
    target = directory / (note_id + (".zip" if files else "." + format))

    def write():
        if files:
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("document." + format, content)
                for source, name in files.values():
                    archive.write(source, name)
        else:
            target.write_text(content, encoding="utf-8")

    try:
        await asyncio.to_thread(write)
        return target
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
