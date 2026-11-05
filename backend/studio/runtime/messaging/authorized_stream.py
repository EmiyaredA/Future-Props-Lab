"""Stop an async source when its authorization changes, including silent sources."""

import asyncio
from contextlib import aclosing, suppress


async def authorized_stream(source, check, *, interval=1):
    async with aclosing(source) as stream:
        if check is None:
            async for item in stream:
                yield item
            return
        await check()

        async def monitor():
            while True:
                await asyncio.sleep(interval)
                await check()

        pending = None
        watcher = asyncio.create_task(monitor())
        try:
            while True:
                pending = asyncio.create_task(anext(stream, None))
                done, _ = await asyncio.wait(
                    (pending, watcher), return_when=asyncio.FIRST_COMPLETED
                )
                if watcher in done:
                    await watcher
                item = await pending
                pending = None
                if item is None:
                    return
                yield item
        finally:
            if pending is not None:
                pending.cancel()
                with suppress(asyncio.CancelledError, StopAsyncIteration):
                    await pending
            watcher.cancel()
            with suppress(asyncio.CancelledError):
                try:
                    await watcher
                except Exception:
                    # Its original error was already raised above.
                    pass
