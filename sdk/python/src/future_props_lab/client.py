"""Transport shared by generated resources and handwritten workflow helpers."""

import asyncio
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from pydantic import TypeAdapter

from .encoding import UNSET, Unset, encode, form_fields
from .errors import ApiError, RevisionConflict, TaskFailed, TaskTimeout
from .generated.resources import AsyncResources, SyncResources
from .streams import AsyncDownload, AsyncEventStream, Download, EventStream, event_model_for


def _arguments(path, parameters, body, media_type, files):
    query = {}
    headers = {}
    for name, location, value in parameters:
        if isinstance(value, Unset):
            continue
        value = encode(value)
        if location == "path":
            path = path.replace("{" + name + "}", quote(str(value), safe=""))
        elif location == "query":
            query[name] = value
        elif location == "header":
            headers[name] = str(value)
    args: dict[str, Any] = {"params": query, "headers": headers}
    if media_type == "multipart/form-data":
        args.update(data=form_fields(body if not isinstance(body, Unset) else {}), files=files)
    elif not isinstance(body, Unset):
        args["json"] = encode(body)
    return path, args


def _error(response):
    try:
        problem = response.json()
    except ValueError:
        problem = {"code": "http_error", "message": response.reason_phrase}
    error = ApiError(response.status_code, problem)
    if response.status_code == 409 and error.code == "revision_conflict":
        error = RevisionConflict(response.status_code, problem)
    return error


class _Configuration:
    def _configure(self, base_url, api_key, origin):
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("base_url must be an HTTP(S) server URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("base_url cannot contain credentials, query or fragment")
        self.base_url = base_url.rstrip("/")
        self.origin = origin or f"{parsed.scheme}://{parsed.netloc}"
        self._api_key = api_key

    def _session_headers(self, method, headers):
        headers = dict(headers)
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        elif method not in {"GET", "HEAD", "OPTIONS"}:
            headers["Origin"] = self.origin
            csrf = self._http.cookies.get("fpl_csrf")
            if csrf:
                headers["X-CSRF-Token"] = csrf
        return headers

    def __repr__(self):
        return f"{type(self).__name__}(base_url={self.base_url!r})"


class Client(_Configuration, SyncResources):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None = None,
        origin: str | None = None,
        timeout: float | httpx.Timeout = 120,
        transport: httpx.BaseTransport | None = None,
    ):
        from .generated.resources import RESOURCES

        self._configure(base_url, api_key, origin)
        self._http = httpx.Client(timeout=timeout, transport=transport, follow_redirects=False)
        for name, resource in RESOURCES.items():
            setattr(self, name, resource(self))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self._http.close()

    def _call(
        self, method, path, parameters=(), body=UNSET, media_type="", files=None, response_type=Any
    ):
        if self._api_key and path == "/v1/auth/login":
            raise ValueError("Use a separate Session client without api_key to log in")
        path, args = _arguments(path, parameters, body, media_type, files)
        args["headers"] = self._session_headers(method, args["headers"])
        response = self._http.send(
            self._http.build_request(method, self.base_url + path, **args),
            stream=True,
        )
        try:
            if not response.is_success:
                response.read()
                raise _error(response)
            content_type = response.headers.get("content-type", "")
            if "text/event-stream" in content_type:
                return EventStream(response, event_model_for(path))
            if response.status_code == 204:
                response.close()
                return None
            if "json" not in content_type or response.headers.get("content-disposition"):
                return Download(response)
            response.read()
            return TypeAdapter(response_type).validate_python(response.json())
        except BaseException:
            response.close()
            raise
        finally:
            if response.is_stream_consumed:
                response.close()

    def wait_for(
        self, fetch: Callable[[], Any], *, task_id: str, timeout: float = 600, interval: float = 1
    ):
        if timeout <= 0 or interval <= 0:
            raise ValueError("timeout and interval must be positive")
        deadline = time.monotonic() + timeout
        while True:
            task = fetch()
            status = task.get("status") if isinstance(task, dict) else task.status
            if status == "completed":
                return task
            if status in {"failed", "cancelled"}:
                raise TaskFailed(task)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TaskTimeout(task_id)
            time.sleep(min(interval, remaining))

    def realtime(self):
        from .realtime import RealtimeConnection

        if self._api_key:
            raise ValueError("Realtime requires a Session client; login first")
        return RealtimeConnection(self)


class AsyncClient(_Configuration, AsyncResources):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None = None,
        origin: str | None = None,
        timeout: float | httpx.Timeout = 120,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        from .generated.resources import ASYNC_RESOURCES

        self._configure(base_url, api_key, origin)
        self._http = httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False)
        for name, resource in ASYNC_RESOURCES.items():
            setattr(self, name, resource(self))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        await self._http.aclose()

    async def _call(
        self, method, path, parameters=(), body=UNSET, media_type="", files=None, response_type=Any
    ):
        if self._api_key and path == "/v1/auth/login":
            raise ValueError("Use a separate Session client without api_key to log in")
        path, args = _arguments(path, parameters, body, media_type, files)
        args["headers"] = self._session_headers(method, args["headers"])
        response = await self._http.send(
            self._http.build_request(method, self.base_url + path, **args),
            stream=True,
        )
        try:
            if not response.is_success:
                await response.aread()
                raise _error(response)
            content_type = response.headers.get("content-type", "")
            if "text/event-stream" in content_type:
                return AsyncEventStream(response, event_model_for(path))
            if response.status_code == 204:
                await response.aclose()
                return None
            if "json" not in content_type or response.headers.get("content-disposition"):
                return AsyncDownload(response)
            await response.aread()
            return TypeAdapter(response_type).validate_python(response.json())
        except BaseException:
            await response.aclose()
            raise
        finally:
            if response.is_stream_consumed:
                await response.aclose()

    async def wait_for(self, fetch, *, task_id: str, timeout: float = 600, interval: float = 1):
        if timeout <= 0 or interval <= 0:
            raise ValueError("timeout and interval must be positive")
        deadline = time.monotonic() + timeout
        while True:
            task = await fetch()
            status = task.get("status") if isinstance(task, dict) else task.status
            if status == "completed":
                return task
            if status in {"failed", "cancelled"}:
                raise TaskFailed(task)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TaskTimeout(task_id)
            await asyncio.sleep(min(interval, remaining))

    def realtime(self):
        from .realtime import AsyncRealtimeConnection

        if self._api_key:
            raise ValueError("Realtime requires a Session client; login first")
        return AsyncRealtimeConnection(self)
