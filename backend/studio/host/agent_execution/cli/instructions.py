"""Track acknowledgments on the same transport reader as the active CLI turn."""

import asyncio


class LiveInstructions:
    def __init__(self, *, timeout=8):
        self.send = None
        self.pending = {}
        self.outcomes = {}
        self.timeout = timeout

    @property
    def ready(self):
        return self.send is not None

    async def submit(self, identity, text):
        send = self.send
        if send is None:
            return "rejected"
        future = asyncio.get_running_loop().create_future()
        self.pending[identity] = future
        try:
            async with asyncio.timeout(self.timeout):
                await send(identity, text)
                return await future
        except (TimeoutError, OSError, RuntimeError):
            return "unknown"
        finally:
            self.pending.pop(identity, None)

    def acknowledge(self, identity, status):
        future = self.pending.get(identity)
        if future is not None and not future.done():
            self.outcomes[identity] = status
            future.set_result(status)

    def close(self):
        self.send = None
        for identity in self.pending:
            self.acknowledge(identity, "unknown")
