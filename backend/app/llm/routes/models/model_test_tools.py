from fastapi import APIRouter, HTTPException, Query, status

from app.deps import SessionDep
from app.llm.playground.test_tools import (
    DuplicateTestToolError,
    ModelTestTools,
    TestToolInputError,
    TestToolInUseError,
    TestToolNotFoundError,
)
from app.llm.schemas.model_test_tools import (
    ModelTestToolCallOut,
    ModelTestToolCatalogOut,
    ModelTestToolCreateIn,
    ModelTestToolExecuteIn,
    ModelTestToolOut,
    ModelTestToolPatchIn,
)

router = APIRouter(prefix="/model-test/tools", tags=["model-test-tools"])


def _raise(exc: Exception) -> None:
    if isinstance(exc, TestToolNotFoundError):
        code, response_status = "not_found", 404
    elif isinstance(exc, DuplicateTestToolError):
        code, response_status = "duplicate_test_tool", 409
    elif isinstance(exc, TestToolInUseError):
        raise HTTPException(
            409,
            detail={"code": "tool_in_use", "message": str(exc), "usage_count": exc.count},
        ) from None
    else:
        code, response_status = "invalid_tool_input", 422
    raise HTTPException(response_status, detail={"code": code, "message": str(exc)}) from None


@router.get("", response_model=ModelTestToolCatalogOut)
async def list_tools(session: SessionDep) -> ModelTestToolCatalogOut:
    return await ModelTestTools(session).catalog()


@router.post("", response_model=ModelTestToolOut, status_code=status.HTTP_201_CREATED)
async def create_tool(session: SessionDep, body: ModelTestToolCreateIn) -> ModelTestToolOut:
    try:
        return await ModelTestTools(session).create(body)
    except DuplicateTestToolError as exc:
        _raise(exc)


@router.get("/{tool_id}", response_model=ModelTestToolOut)
async def get_tool(session: SessionDep, tool_id: str) -> ModelTestToolOut:
    try:
        return await ModelTestTools(session).get(tool_id)
    except TestToolNotFoundError as exc:
        _raise(exc)


@router.patch("/{tool_id}", response_model=ModelTestToolOut)
async def update_tool(
    session: SessionDep, tool_id: str, body: ModelTestToolPatchIn
) -> ModelTestToolOut:
    try:
        return await ModelTestTools(session).update(tool_id, body)
    except (TestToolNotFoundError, DuplicateTestToolError) as exc:
        _raise(exc)


@router.delete("/{tool_id}")
async def delete_tool(
    session: SessionDep, tool_id: str, expected_revision: int = Query(ge=0)
) -> dict[str, bool]:
    try:
        await ModelTestTools(session).delete(tool_id, expected_revision)
    except (TestToolNotFoundError, TestToolInUseError) as exc:
        _raise(exc)
    return {"deleted": True}


@router.post("/{tool_id}/execute", response_model=ModelTestToolCallOut)
async def execute_tool(
    session: SessionDep, tool_id: str, body: ModelTestToolExecuteIn
) -> ModelTestToolCallOut:
    try:
        return await ModelTestTools(session).execute(tool_id, body)
    except (TestToolNotFoundError, TestToolInputError) as exc:
        _raise(exc)
