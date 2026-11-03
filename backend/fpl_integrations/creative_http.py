"""Private Creative target operations; unavailable without an Identity-backed authority."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeStdioConfiguration
from fpl_runtime.integration_intents import digest

router = APIRouter(prefix="/_internal/v1/creative-integrations", include_in_schema=False)


def authority(request, purpose, value):
    # This dependency must independently validate the Identity-signed original
    # request and its binding to this exact destination payload. It must not turn
    # a caller-supplied digest into an authorization decision.
    verifier = getattr(request.app.state, "creative_authorization", None)
    if verifier is None:
        raise HTTPException(503, "creative_authorization_unavailable")
    operation = value.release_id if purpose == "setup" else value.operation_id
    checksum = digest(value.model_dump(mode="json"))

    async def check():
        return await verifier.grant(
            request=request, purpose=purpose, operation_id=operation, fingerprint=checksum
        )

    return check


async def payload(request, model):
    try:
        return model.model_validate_json(await request.body())
    except (ValidationError, ValueError):
        # Never echo stdio environment values in validation responses.
        raise HTTPException(422, "creative_request_invalid") from None


@router.post("/preview")
async def preview(request: Request):
    value = await payload(request, CreativeInstallBatch)
    return await request.app.state.creative_installations.preview(
        value, authority(request, "preview", value)
    )


@router.post("/receipt")
async def receipt(request: Request):
    value = await payload(request, CreativeInstallBatch)
    result = await request.app.state.creative_installations.receipt(
        value, authority(request, "install", value)
    )
    if result is None:
        raise HTTPException(404, "creative_install_not_found")
    return result


@router.post("/install")
async def install(request: Request):
    async with request.form(max_files=50, max_fields=1, max_part_size=1024 * 1024) as form:
        entries = form.multi_items()
        batches = [value for key, value in entries if key == "batch"]
        if len(batches) != 1 or not isinstance(batches[0], str):
            raise HTTPException(422, "creative_request_invalid")
        try:
            value = CreativeInstallBatch.model_validate_json(batches[0])
        except ValidationError:
            raise HTTPException(422, "creative_request_invalid") from None
        archives = {}
        for key, item in entries:
            if key == "batch":
                continue
            if not isinstance(item, UploadFile) or key in archives:
                raise HTTPException(422, "creative_install_archive_mismatch")
            archives[key] = item
        return await request.app.state.creative_installations.install(
            value, archives, authority(request, "install", value)
        )


@router.post("/stdio")
async def stdio(request: Request):
    value = await payload(request, CreativeStdioConfiguration)
    return await request.app.state.creative_installations.configure_stdio(
        value, authority(request, "setup", value)
    )


class CreativeRequestLimit:
    """Count incoming chunks without buffering uploaded archives in memory."""

    def __init__(self, app, maximum=32 * 1024 * 1024):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith(
            "/_internal/v1/creative-integrations/"
        ):
            await self.app(scope, receive, send)
            return
        from starlette.formparsers import MultiPartException
        from starlette.responses import JSONResponse

        count = 0

        class TooLarge(MultiPartException):
            pass

        async def bounded():
            nonlocal count
            message = await receive()
            count += len(message.get("body", b""))
            if count > self.maximum:
                raise TooLarge("creative_request_too_large")
            return message

        try:
            await self.app(scope, bounded, send)
        except TooLarge:
            await JSONResponse({"code": "request_too_large"}, status_code=413)(scope, receive, send)
