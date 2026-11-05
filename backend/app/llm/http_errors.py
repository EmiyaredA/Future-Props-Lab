"""Model operation error translation without importing another router or its execution stack."""

from fastapi import HTTPException
from pydantic import ValidationError

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.transcription import TranscriptionParameterError
from app.runtime.operation_receipts import OperationError


async def mapped(operation):
    try:
        return await operation
    except (OperationError, AssetError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422,
            {"code": "invalid_parameters", "errors": exc.errors(include_context=False)},
        ) from None
    except TranscriptionParameterError as exc:
        raise HTTPException(422, {"code": "unsupported_parameter", "message": str(exc)}) from None
