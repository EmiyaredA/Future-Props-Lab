"""Legacy-normalized Story values, without foreign asset access."""

from pydantic import ValidationError

from studio.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentOut, GalgameStoryProject
from studio.apps.galgame_workshop.storage.models import GalgameStoryDocument
from studio.runtime.time import iso_utc


def default_story_document() -> GalgameStoryProject:
    return GalgameStoryProject.model_validate(
        {
            "schemaVersion": "1.4",
            "entryChapterId": "chapter-1",
            "synopsis": "",
            "characters": [],
            "scenes": [],
            "cgs": [],
            "variables": [],
            "assets": [],
            "chapters": [
                {
                    "id": "chapter-1",
                    "title": "第一章",
                    "order": 1,
                    "entryFragmentId": "main",
                    "fragments": [{"id": "main", "title": "main", "blocks": []}],
                }
            ],
        }
    )


def normalize_story_document(value: object) -> GalgameStoryProject:
    if not isinstance(value, dict):
        raise GalgameStoryDocumentInvalidError("故事文档格式无效")
    candidate = dict(value)
    if "schemaVersion" not in candidate:
        candidate["schemaVersion"] = "1.4"
        candidate.setdefault("synopsis", "")
        candidate.setdefault("characters", [])
        candidate.setdefault("scenes", [])
        candidate.setdefault("cgs", [])
        candidate.setdefault("variables", [])
        candidate.setdefault("assets", [])
        if not candidate.get("chapters"):
            candidate["chapters"] = default_story_document().model_dump(mode="json", by_alias=True)[
                "chapters"
            ]
    try:
        return GalgameStoryProject.model_validate(candidate)
    except ValidationError as exc:
        raise GalgameStoryDocumentInvalidError("故事文档不是受支持的 Story V1 格式") from exc


def story_out(row: GalgameStoryDocument, document: GalgameStoryProject) -> GalgameStoryDocumentOut:
    return GalgameStoryDocumentOut(
        project_id=row.project_id,
        document=document,
        revision=row.revision,
        updated_at=iso_utc(row.updated_at),
    )
