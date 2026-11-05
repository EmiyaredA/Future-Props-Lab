"""Keep blocking I/O owned by its caller until the worker has actually stopped."""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


async def run_blocking_io(operation: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    """Delay cancellation until I/O ends, so callers can safely remove borrowed files.

    This does not interrupt the underlying operation. Its adapter must bound the work;
    cancellation wins over a late result or error, including repeated cancel requests.
    """
    worker = asyncio.create_task(asyncio.to_thread(operation, *args, **kwargs))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        while not worker.done():
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        with suppress(Exception):
            worker.result()
        raise
