"""Release derived content even when ASGI send fails or the response task is cancelled."""

from urllib.parse import quote

from starlette.responses import FileResponse, StreamingResponse

from studio.contracts.media_rendering.output import MediaOutput
from studio.runtime.files.media_output import FileMediaOutput


def media_response(output: MediaOutput, *, download=False, headers=None):
    class ReleasingFileResponse(FileResponse):
        async def __call__(self, scope, receive, send):
            try:
                # A temporary pathname cannot outlive this response. Disable the
                # server path handoff so all bytes are sent before releasing it.
                if output.temporary:
                    scope = {
                        **scope,
                        "extensions": {
                            key: value
                            for key, value in scope.get("extensions", {}).items()
                            if key != "http.response.pathsend"
                        },
                    }
                await super().__call__(scope, receive, send)
            finally:
                output.close()

    class ReleasingStreamResponse(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try:
                await super().__call__(scope, receive, send)
            finally:
                output.close()

    if isinstance(output, FileMediaOutput):
        return ReleasingFileResponse(
            output.path,
            media_type=output.media_type,
            filename=output.filename if download else None,
            headers=headers,
        )

    def chunks():
        with output.open() as source:
            while chunk := source.read(1024 * 1024):
                yield chunk

    response_headers = {"Content-Length": str(output.byte_size), **(headers or {})}
    if download:
        response_headers["Content-Disposition"] = "attachment; filename*=utf-8''" + quote(
            output.filename
        )
    return ReleasingStreamResponse(chunks(), media_type=output.media_type, headers=response_headers)
