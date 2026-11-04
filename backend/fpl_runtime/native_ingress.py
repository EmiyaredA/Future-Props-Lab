"""Authenticate fixed host worker identities behind the dedicated loopback bridge."""

import re
import secrets

from pydantic import BaseModel, ConfigDict, model_validator
from starlette.datastructures import Headers
from starlette.responses import JSONResponse


class NativeWorkerOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ingress: str
    identity_credential: str
    workers: dict[str, str]

    @model_validator(mode="after")
    def credentials(self):
        values = [self.ingress, self.identity_credential, *self.workers.values()]
        if (
            not self.workers
            or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key) for key in self.workers)
            or any(not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", value) for value in values)
            or len(set(values)) != len(values)
        ):
            raise ValueError("原生通道与各执行器必须使用独立凭据")
        return self


class NativeIngress:
    def __init__(self, app, *, options, state_key="connection_worker"):
        self.app, self.options = app, options
        self.state_key = state_key

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = None
        if (
            self.options is not None
            and "origin" not in headers
            and "cookie" not in headers
            and secrets.compare_digest(
                headers.get("x-fpl-native-ingress", "").encode(), self.options.ingress.encode()
            )
            and headers.get("authorization", "").startswith("Bearer ")
        ):
            token = headers["authorization"][7:].encode()
            worker = next(
                (
                    key
                    for key, value in self.options.workers.items()
                    if secrets.compare_digest(token, value.encode())
                ),
                None,
            )
        if worker is None:
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        state = {**scope.get("state", {}), self.state_key: worker}
        await self.app({**scope, "state": state}, receive, send)
