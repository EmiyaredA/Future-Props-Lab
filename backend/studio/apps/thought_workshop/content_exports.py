import asyncio
import html
import shutil
import tempfile
import zipfile
from pathlib import Path

import mistune

from studio.apps.thought_workshop.canvas_export import CanvasHtmlRenderer, canvas_sources
from studio.apps.thought_workshop.markdown_conversion import markdown, parse_markdown
from studio.apps.thought_workshop.multitable.content import project
from studio.apps.thought_workshop.notes import Notes, note_out
from studio.apps.thought_workshop.schemas.conversion import ThoughtMarkdownOut
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.website.asset_metadata import metadata
from studio.runtime.revisions import RevisionConflictError


async def resolve_assets(session, owner_user_id, ids):
    return await metadata(session, owner_user_id).describe(set(ids)) if ids else {}


async def convert(session, owner_user_id, body):
    rows = await resolve_assets(session, owner_user_id, set(body.assets.values()))
    document, warnings = parse_markdown(
        body.markdown, {path: rows[id] for path, id in body.assets.items()}
    )
    return ThoughtMarkdownOut(document=document, warnings=warnings)


async def export_note(session, owner_user_id, note_id, expected_revision, format):
    note = await Notes(session, owner_user_id).get(note_id)
    if note.revision != expected_revision:
        raise RevisionConflictError(
            expected_revision, note.revision, note_out(note).model_dump(mode="json")
        )
    assets = await resolve_assets(session, owner_user_id, file_ids(note.document))
    files = {
        id: "assets/" + id + Path(row.original_filename).suffix.lower()
        for id, row in assets.items()
    }
    title, document = note.title, await project(session, owner_user_id, note)
    await session.rollback()
    content = "# " + title + "\n\n" + markdown(document, files)
    if format == "html":
        # Canvas nodes are inert SVG. Mermaid retains the established escaped-source
        # server export; the Web exporter supplies its rendered offline SVG version.
        render = mistune.create_markdown(
            renderer=CanvasHtmlRenderer(canvas_sources(document, files)),
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
    sources = directory / "sources"
    sources.mkdir()
    target = directory / (note_id + (".zip" if files else "." + format))

    def write():
        if files:
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("document." + format, content)
                for id, name in files.items():
                    archive.write(sources / id, name)
        else:
            target.write_text(content, encoding="utf-8")

    try:
        for id, asset in assets.items():
            await metadata(session, owner_user_id).download(asset, sources / id)
        await asyncio.to_thread(write)
        return target
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
