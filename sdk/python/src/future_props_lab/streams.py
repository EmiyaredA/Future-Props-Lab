"""Owned HTTP response streams; no reconnect or request replay is implicit."""

import json
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict

from .generated.models import InferenceTextOut


class StreamEvent(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str
    data: Any = None
    id: str | None = None


class InferenceEvent(StreamEvent):
    type: Literal["start", "delta", "done", "error"]
    text: str = ""
    log_id: str | None = None
    result: "InferenceTextOut | None" = None
    message: str | None = None


class ThoughtWritingEvent(StreamEvent):
    type: Literal["delta", "complete", "error"]
    text: str = ""
    message: str = ""


def event_model_for(path):
    if path == "/v1/model-inference/text/stream":
        return InferenceEvent
    if path.startswith("/v1/thought-workshop/notes/") and path.endswith("/assistant"):
        return ThoughtWritingEvent
    return StreamEvent


class EventDecoder:
    def __init__(self, event_model=StreamEvent):
        self.event_model = event_model
        self.lines: list[str] = []
        self.event = "message"
        self.id = None

    def feed(self, line: str) -> StreamEvent | None:
        if line:
            field, _, value = line.partition(":")
            value = value.removeprefix(" ")
            if field == "data":
                self.lines.append(value)
            elif field == "event":
                self.event = value
            elif field == "id" and "\0" not in value:
                self.id = value
            return None
        if not self.lines:
            self.event = "message"
            return None
        raw = "\n".join(self.lines)
        self.lines = []
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw
        payload = dict(data) if isinstance(data, dict) else {}
        payload.setdefault("type", self.event)
        payload.setdefault("data", data)
        payload.setdefault("id", self.id)
        self.event = "message"
        return self.event_model.model_validate(payload)


class EventStream:
    def __init__(self, response: httpx.Response, event_model=StreamEvent):
        self.response = response
        self.event_model = event_model

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.response.close()

    def __iter__(self):
        decoder = EventDecoder(self.event_model)
        try:
            for line in self.response.iter_lines():
                event = decoder.feed(line)
                if event is not None:
                    yield event
        finally:
            self.close()


class AsyncEventStream:
    def __init__(self, response: httpx.Response, event_model=StreamEvent):
        self.response = response
        self.event_model = event_model

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        await self.response.aclose()

    async def __aiter__(self):
        decoder = EventDecoder(self.event_model)
        try:
            async for line in self.response.aiter_lines():
                event = decoder.feed(line)
                if event is not None:
                    yield event
        finally:
            await self.aclose()


class Download:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.content_type = response.headers.get("content-type", "application/octet-stream")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.response.close()

    def iter_bytes(self, chunk_size: int = 65536):
        try:
            yield from self.response.iter_bytes(chunk_size)
        finally:
            self.response.close()

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        with target.open("wb") as output:
            for chunk in self.iter_bytes():
                output.write(chunk)
        return target


class AsyncDownload:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.content_type = response.headers.get("content-type", "application/octet-stream")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.response.aclose()

    async def iter_bytes(self, chunk_size: int = 65536):
        try:
            async for chunk in self.response.aiter_bytes(chunk_size):
                yield chunk
        finally:
            await self.response.aclose()

    async def save(self, path: str | Path) -> Path:
        target = Path(path)
        with target.open("wb") as output:
            async for chunk in self.iter_bytes():
                output.write(chunk)
        return target
