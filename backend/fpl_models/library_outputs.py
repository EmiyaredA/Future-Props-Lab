"""Deliver only an authorized Models result; identical retries reuse the Assets receipt."""

import asyncio
from contextlib import aclosing

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.schemas.files import VisualAssetOut
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.model_outputs import ModelOutputDescription


class HttpLibraryOutputs:
    def __init__(self, capabilities, *, assertion, method, path, max_bytes):
        self.capabilities, self.assertion, self.method, self.path, self.max_bytes = (
            capabilities,
            assertion,
            method,
            path,
            max_bytes,
        )

    async def save(self, task_id, path, filename, mime_type):
        try:
            description = await asyncio.to_thread(
                ModelOutputDescription.from_file, path, filename, mime_type
            )
            if description.byte_size > self.max_bytes:
                raise AssetError("结果文件超过文件库上限", code="file_too_large", status=413)

            async def chunks():
                with path.open("rb") as source:
                    while chunk := await asyncio.to_thread(source.read, 1024 * 1024):
                        yield chunk

            async with aclosing(chunks()) as content:
                result = await self.capabilities.model_library_output(
                    assertion=self.assertion,
                    source_method=self.method,
                    source_path=self.path,
                    task_id=task_id,
                    description=description,
                    content=content,
                )
            return VisualAssetOut.model_validate(result)
        except CapabilityDenied as exc:
            status = exc.status if exc.status in {401, 403, 404, 409, 413, 422} else 503
            raise AssetError(
                "模型结果未能保存", code="library_output_denied", status=status
            ) from None
        except (CapabilityUnavailable, OSError, ValueError):
            raise AssetError(
                "模型结果保存未确认，请重试核验原回执", code="library_output_unknown", status=503
            ) from None
