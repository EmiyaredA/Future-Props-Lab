"""Bound internal JSON requests before parsers allocate an unbounded body."""

from starlette.responses import JSONResponse


class RequestLimit:
    def __init__(self, app, *, prefix, maximum, exact=False, streaming_prefix=None):
        self.app, self.prefix, self.maximum, self.exact = app, prefix, maximum, exact
        self.streaming_prefix = streaming_prefix

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        matches = path == self.prefix if self.exact else path.startswith(self.prefix)
        if not matches or (self.streaming_prefix and path.startswith(self.streaming_prefix)):
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.maximum:
                await JSONResponse(
                    {"code": "request_too_large"}, 413, headers={"Cache-Control": "no-store"}
                )(scope, receive, send)
                return
            if not message.get("more_body"):
                break
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, bounded_receive, send)
