"""Private Creative target operations; unavailable without an Identity-backed authority."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.responses import JSONResponse

from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeStdioConfiguration
from fpl_runtime.creative_results import CreativeResultAuthenticator
from fpl_runtime.creative_source_evidence import strict_json
from fpl_runtime.creative_transport import CreativeInstallSourceContext
from fpl_runtime.integration_intents import digest

router = APIRouter(prefix="/_internal/v1/creative-integrations", include_in_schema=False)


def authority(request, purpose, value, source=None):
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
            request=request,
            purpose=purpose,
            operation_id=operation,
            fingerprint=checksum,
            value=value,
            source=source,
        )

    return check


def result_response(request, action, batch, result, *, status=200):
    response = JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})
    verifier = getattr(request.app.state, "creative_authorization", None)
    signer = getattr(verifier, "result_authenticator", None)
    if isinstance(signer, CreativeResultAuthenticator):
        response.headers["X-Fpl-Creative-Result"] = signer.sign(
            action=action,
            operation=batch.operation_id,
            fingerprint=digest(batch.model_dump(mode="json")),
            nonce=request.headers.get("x-fpl-creative-nonce", ""),
            status=status,
            body=response.body,
        )
    return response


async def payload(request, model):
    try:
        raw = strict_json(await request.body())
        if isinstance(raw, dict) and set(raw) == {"batch", "source"}:
            return model.model_validate(raw["batch"]), CreativeInstallSourceContext.model_validate(
                raw["source"]
            )
        return model.model_validate(raw), None
    except (ValidationError, ValueError, TypeError):
        # Never echo stdio environment values in validation responses.
        raise HTTPException(422, "creative_request_invalid") from None


@router.post("/preview")
async def preview(request: Request):
    value, source = await payload(request, CreativeInstallBatch)
    return await request.app.state.creative_installations.preview(
        value, authority(request, "preview", value, source)
    )


@router.post("/receipt")
async def receipt(request: Request):
    value, source = await payload(request, CreativeInstallBatch)
    result = await request.app.state.creative_installations.receipt(
        value, authority(request, "receipt", value, source)
    )
    if result is None:
        return result_response(
            request, "receipt", value, {"detail": "creative_install_not_found"}, status=404
        )
    return result_response(request, "receipt", value, result)


@router.post("/cancel")
async def cancel(request: Request):
    value, source = await payload(request, CreativeInstallBatch)
    result = await request.app.state.creative_installations.cancel(
        value, authority(request, "cancel", value, source)
    )
    return result_response(request, "cancel", value, result)


@router.post("/install")
async def install(request: Request):
    async with request.form(max_files=50, max_fields=2, max_part_size=1024 * 1024) as form:
        entries = form.multi_items()
        batches = [value for key, value in entries if key == "batch"]
        if len(batches) != 1 or not isinstance(batches[0], str):
            raise HTTPException(422, "creative_request_invalid")
        try:
            value = CreativeInstallBatch.model_validate_json(batches[0])
        except ValidationError:
            raise HTTPException(422, "creative_request_invalid") from None
        contexts = [value for key, value in entries if key == "source"]
        if len(contexts) > 1 or (contexts and not isinstance(contexts[0], str)):
            raise HTTPException(422, "creative_request_invalid")
        try:
            source = (
                CreativeInstallSourceContext.model_validate(strict_json(contexts[0].encode()))
                if contexts
                else None
            )
        except (ValidationError, ValueError, TypeError):
            raise HTTPException(422, "creative_request_invalid") from None
        archives = {}
        for key, item in entries:
            if key in {"batch", "source"}:
                continue
            if not isinstance(item, UploadFile) or key in archives:
                raise HTTPException(422, "creative_install_archive_mismatch")
            archives[key] = item
        result = await request.app.state.creative_installations.install(
            value, archives, authority(request, "install", value, source)
        )
        return result_response(request, "install", value, result)


@router.post("/stdio")
async def stdio(request: Request):
    value, source = await payload(request, CreativeStdioConfiguration)
    return await request.app.state.creative_installations.configure_stdio(
        value, authority(request, "setup", value, source)
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
