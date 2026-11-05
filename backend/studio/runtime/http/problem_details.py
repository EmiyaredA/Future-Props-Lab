from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from studio.runtime.http.account_errors import error_detail
from studio.runtime.revisions import RevisionConflictError


def problem(
    request: Request,
    status: int,
    detail: str,
    *,
    code: str,
    extra: dict | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    content = {
        "type": "about:blank",
        "title": detail,
        "status": status,
        "detail": detail,
        "instance": request.url.path,
        "code": code,
    }
    if extra:
        content.update(extra)
    return JSONResponse(content, status_code=status, headers=headers)


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        detail = str(exc.detail.get("message") or exc.detail.get("detail") or "请求失败")
        code = str(exc.detail.get("code") or "http_error")
        extra = {k: v for k, v in exc.detail.items() if k not in {"message", "detail", "code"}}
    else:
        detail = str(exc.detail)
        code = "http_error"
        extra = {}
    return problem(
        request,
        exc.status_code,
        detail,
        code=code,
        extra=extra,
        headers=exc.headers,
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    if request.url.path == "/v1/cloud-control/desktop/connect":
        return problem(request, 422, "VNC 密码格式无效", code="validation_error")
    return problem(
        request,
        422,
        "请求参数无效",
        code="validation_error",
        # Validator contexts may contain exception instances, which are useful
        # for Python debugging but are not JSON serializable protocol data.
        extra={
            "errors": [
                {key: value for key, value in error.items() if key != "ctx"}
                for error in exc.errors()
            ]
        },
    )


async def revision_conflict_handler(request: Request, exc: RevisionConflictError) -> JSONResponse:
    return problem(
        request,
        409,
        "内容已被其他操作更新",
        code="revision_conflict",
        extra={
            "expected_revision": exc.expected,
            "current_revision": exc.current,
            "current": exc.snapshot,
        },
    )


async def storage_operational_error_handler(
    request: Request, exc: OperationalError
) -> JSONResponse:
    locked = "database is locked" in str(exc.orig).lower()
    return problem(
        request,
        503,
        "数据库正忙，请稍后重试" if locked else "数据库暂时不可用",
        code="storage_busy" if locked else "storage_unavailable",
        headers={"Retry-After": "1"},
    )


async def account_exception_handler(request: Request, exc) -> JSONResponse:
    status, detail = error_detail(exc)
    return await http_exception_handler(request, HTTPException(status, detail))
