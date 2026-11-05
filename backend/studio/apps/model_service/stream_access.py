"""Revalidate the accepted Models source request without another account's state."""

from fastapi import HTTPException


def access_check(identity, request):
    assertion = request.state.service_assertion
    method, path = request.method, request.url.path

    async def check():
        active = await identity.status(assertion=assertion, method=method, path=path)
        if active is not True:
            raise HTTPException(
                401 if active is False else 503, {"code": "model_stream_authorization_unavailable"}
            )

    return check
