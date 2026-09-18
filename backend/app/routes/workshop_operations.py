"""HTTP adapters for owner-validated editing batches."""

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.audio_annotation.operations import apply_operations as annotation_operations
from app.audio_annotation.projects import AudioAnnotationError
from app.deps import SessionDep, StudioAuth, WorkspaceDep
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.operations import apply_operations as galgame_operations
from app.runtime.operation_receipts import OperationError
from app.schemas.annotation_operations import AnnotationOperationsIn
from app.schemas.audio_annotation import AudioAnnotationDocumentOut
from app.schemas.galgame_operations import GalgameOperationsIn
from app.schemas.galgame_workshop import GalgameStoryDocumentOut
from app.schemas.thought_operations import ThoughtOperationsIn
from app.schemas.thought_workshop import ThoughtNoteOut
from app.schemas.visual_operations import VisualOperationsIn
from app.schemas.visual_workshop import VisualCanvasDocumentOut
from app.thought_workshop.errors import ThoughtError
from app.thought_workshop.operations import apply_operations as thought_operations
from app.visual_workshop.canvas import VisualCanvasError
from app.visual_workshop.operations import apply_operations as visual_operations

router = APIRouter()


async def mapped(operation):
    try:
        return await operation
    except (
        OperationError,
        AudioAnnotationError,
        ThoughtError,
        VisualCanvasError,
    ) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None
    except (GalgameStoryDocumentNotFoundError, GalgameWorkshopProjectNotFoundError) as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise HTTPException(422, {"code": "invalid_story", "message": str(exc)}) from None


@router.post(
    "/visual-workshop/projects/{project_id}/canvas/operations",
    response_model=VisualCanvasDocumentOut,
    tags=["visual-workshop"],
)
async def apply_canvas_operations(
    project_id: str, body: VisualOperationsIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await mapped(visual_operations(session, workspace_id, project_id, body))


@router.post(
    "/galgame-workshop/projects/{project_id}/story/operations",
    response_model=GalgameStoryDocumentOut,
    tags=["galgame-workshop"],
)
async def apply_story_operations(
    project_id: str, body: GalgameOperationsIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await mapped(galgame_operations(session, workspace_id, project_id, body))


@router.post(
    "/audio-annotation/projects/{project_id}/document/operations",
    response_model=AudioAnnotationDocumentOut,
    tags=["audio-annotation"],
)
async def apply_annotation_operations(
    project_id: str, body: AnnotationOperationsIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await mapped(annotation_operations(session, workspace_id, project_id, body))


@router.post(
    "/thought-workshop/notes/{note_id}/operations",
    response_model=ThoughtNoteOut,
    tags=["thought-workshop"],
)
async def apply_note_operations(
    note_id: str, body: ThoughtOperationsIn, session: SessionDep, principal: StudioAuth
):
    return await mapped(
        thought_operations(session, principal.workspace_id, note_id, body, principal.user_id)
    )
