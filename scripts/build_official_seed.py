"""Build the ordinary-note import package without writing runtime data."""

import json
import re
import subprocess
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.apps.thought_workshop.markdown_conversion import parse_markdown  # noqa: E402
from app.apps.thought_workshop.schemas.document import validate_document  # noqa: E402

raw = json.loads(
    subprocess.check_output(
        ["node", "--import", "tsx", "scripts/official_seed_source.ts"], cwd=ROOT, text=True
    )
)


def uid(x):
    return str(uuid5(NAMESPACE_URL, "fpl-seed/" + x))


notes = []
projects = []
origins = []
lookup = {
    (lib["id"], doc["id"]): uid(lib["id"] + "/" + doc["id"])
    for lib in raw["libraries"]
    for doc in lib["documents"]
}
lookup.update({(lib["id"], ""): uid(lib["id"] + "/home") for lib in raw["libraries"]})


def rewrite(n):
    a = n.get("attrs", {})
    if a.get("kind") == "official":
        target = lookup[(a["libraryId"], a.get("documentId", ""))]
        a.pop("libraryId", None)
        a.pop("documentId", None)
        a["kind"] = "note"
        a["noteId"] = target
    for m in n.get("marks", []):
        if m["type"] == "link":
            match = re.fullmatch(
                r"/apps/thought-workshop/official-knowledge-bases/([^/]+)(?:/documents/([^/#]+))?",
                m["attrs"]["href"],
            )
            if match:
                n.pop("marks", None)
                n["type"] = "documentReference"
                n["attrs"] = {
                    "kind": "note",
                    "noteId": lookup[(match[1], match[2] or "")],
                    "label": n.pop("text"),
                }
    for child in n.get("content", []):
        rewrite(child)


for lib in raw["libraries"]:
    pid = uid(lib["id"])
    home = lookup[(lib["id"], "")]
    projects.append(
        dict(id=pid, title=lib["title"], description=lib["description"], home_note_id=home)
    )
    docs = [dict(id="", title=lib["title"], document=lib["home"])]
    for d in lib["documents"]:
        result = parse_markdown(d["markdown"], {})
        document = result[0] if isinstance(result, tuple) else result
        if (
            document["content"]
            and document["content"][0]["type"] == "heading"
            and document["content"][0].get("attrs", {}).get("level") == 1
        ):
            document["content"].pop(0)
        docs.append(dict(id=d["id"], title=d["title"], document=document))
    for pos, d in enumerate(docs):
        rewrite(d["document"])
        validate_document(d["document"])
        nid = lookup[(lib["id"], d["id"])]
        notes.append(
            dict(
                id=nid,
                knowledge_base_id=pid,
                title=d["title"],
                document=d["document"],
                schema_version=3,
                kind="note",
                tags=[],
                pinned=False,
                favorite=False,
                parent_id=None,
                is_home=pos == 0,
                position=pos,
            )
        )
        origins.append(dict(note_id=nid, library_key=lib["id"], document_key=d["id"]))
payload = dict(
    format="thought-workshop-backup",
    version=7,
    knowledge_bases=projects,
    notes=notes,
    assets=[],
    history=[],
    folders=[],
    templates=[],
    reading_positions=[],
    multitables={},
)
data = json.dumps(dict(archive=payload, origins=origins), ensure_ascii=False, separators=(",", ":"))
target = ROOT / "backend/app/apps/thought_workshop/publication/seed.json"
if "--check" in sys.argv:
    if target.read_text() != data + "\n":
        raise SystemExit("Official import package is stale: run npm run knowledge:seed:generate")
else:
    target.write_text(data + "\n")
print(f"Official import package: {len(projects)} libraries, {len(notes)} notes")
