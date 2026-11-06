"""Bounded, worker-claimed signaling sessions over the private native bridge."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from time import monotonic
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, field_validator

from studio.apps.remote_desktop.transport.app_signaling import HOST_MESSAGES
from studio.contracts.remote_desktop.apps import NativeAppLease

router = APIRouter(prefix="/_native/v1/app-relay", include_in_schema=False)


@dataclass
class Window:
    app_id: str
    id: str = field(default_factory=lambda: uuid4().hex)
    worker: str | None = None
    worker_until: float = 0.0
    commands: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(8))
    events: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(16))

    async def send(self, message):
        await asyncio.wait_for(self.commands.put(message), timeout=3)

    async def receive(self):
        return await self.events.get()


class AppRelay:
    def __init__(self):
        self.window: Window | None = None
        self.available_until = 0.0

    @property
    def ready(self):
        if self.window is not None and self.window.worker is not None:
            return self.window.worker_until > monotonic()
        return self.available_until > monotonic()

    @asynccontextmanager
    async def open(self, app_id):
        if not self.ready:
            raise HTTPException(503, "Mac 远程应用辅助程序尚未就绪")
        if self.window is not None:
            raise HTTPException(409, "Mac 正在处理另一条远程应用连接")
        self.window = Window(app_id)
        try:
            yield self.window
        finally:
            self.window = None

    def claim(self, worker, available):
        if not available:
            return None
        self.available_until = monotonic() + 10
        window = self.window
        if window is None or window.worker is not None:
            return None
        window.worker = worker
        window.worker_until = self.available_until
        return NativeAppLease(session=window.id, app_id=window.app_id)

    def require(self, worker, session):
        window = self.window
        if window is None or window.id != session or window.worker != worker:
            raise HTTPException(410, "远程应用连接已结束")
        self.available_until = monotonic() + 10
        window.worker_until = self.available_until
        return window


class Availability(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    available: bool


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: dict[str, Any] | None

    @field_validator("message")
    @classmethod
    def validate_message(cls, value):
        if value is not None:
            kind = value.get("type")
            if not isinstance(kind, str) or kind not in HOST_MESSAGES | {"activity"}:
                raise ValueError("无效的 Mac 应用事件")
        return value


@router.post("/claim")
async def claim(request: Request, body: Availability):
    return {"lease": request.app.state.app_relay.claim(request.state.remote_worker, body.available)}


@router.post("/{session}/command")
async def command(session: str, request: Request):
    relay = request.app.state.app_relay
    window = relay.require(request.state.remote_worker, session)
    try:
        message = await asyncio.wait_for(window.commands.get(), timeout=2)
    except TimeoutError:
        message = None
    relay.require(request.state.remote_worker, session)
    return {"message": message}


@router.post("/{session}/event")
async def event(session: str, request: Request, body: Event):
    window = request.app.state.app_relay.require(request.state.remote_worker, session)
    try:
        window.events.put_nowait(body.message)
    except asyncio.QueueFull:
        raise HTTPException(409, "远程应用信令接收队列已满") from None
    return {"received": True}
