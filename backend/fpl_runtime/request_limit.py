"""Bound internal JSON requests before parsers allocate an unbounded body."""

from starlette.responses import JSONResponse


class RequestLimit:
    def __init__(self, app, *, prefix, maximum, exact=False):
        self.app, self.prefix, self.maximum, self.exact = app, prefix, maximum, exact

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not (
            scope["path"] == self.prefix if self.exact else scope["path"].startswith(self.prefix)
        ):
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
