"""HTTP adapters for owner-validated editing batches."""

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.deps import SessionDep, WorkspaceDep
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.operations import apply_operations as galgame_operations
from app.runtime.operation_receipts import OperationError
from app.schemas.galgame_operations import GalgameOperationsIn
from app.schemas.galgame_workshop import GalgameStoryDocumentOut

router = APIRouter()


async def mapped(operation):
    try:
        return await operation
    except OperationError as exc:
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
    "/galgame-workshop/projects/{project_id}/story/operations",
    response_model=GalgameStoryDocumentOut,
    tags=["galgame-workshop"],
)
async def apply_story_operations(
    project_id: str, body: GalgameOperationsIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await mapped(galgame_operations(session, workspace_id, project_id, body))
