"""Keep normal request limits and bound the one multipart import before parsing."""

import re

from starlette.exceptions import HTTPException

from app.console.amadeus.files import MAX_FILE_BYTES
from fpl_runtime.request_limit import RequestLimit

IMPORT = re.compile(r"/v1/amadeus/conversations/[^/]+/imports")
MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024


class AmadeusRequestLimits:
    def __init__(self, app):
        self.app = app
        self.records = RequestLimit(app, prefix="/v1/amadeus/", maximum=8 * 1024 * 1024)

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or IMPORT.fullmatch(scope["path"]) is None
        ):
            await self.records(scope, receive, send)
            return
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > MAX_MULTIPART_BYTES:
                raise HTTPException(413, {"code": "request_too_large"})
            return message

        await self.app(scope, bounded_receive, send)
