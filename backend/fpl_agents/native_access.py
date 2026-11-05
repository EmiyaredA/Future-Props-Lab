"""Interactive native reads have explicit ownership and wait outside application transactions."""

import base64
from uuid import uuid4

from fastapi import HTTPException

from fpl_runtime.native_queue import NativeQueueError


class NativeSourceAccess:
    def __init__(self, queue):
        self.queue = queue

    async def request(self, owner, operation, payload):
        try:
            job = await self.queue.enqueue(
                owner=owner, operation=operation, payload=payload, request_id=str(uuid4())
            )
            result = await self.queue.wait(owner=owner, job_id=job["id"])
        except NativeQueueError as exc:
            raise HTTPException(
                503, {"code": exc.code, "message": "Mac 原生采集组件暂不可用"}
            ) from exc
        if result["status"] != "completed":
            if result["status"] == "failed" and result["error_code"] in {
                "ValueError",
                "ValidationError",
                "FileNotFoundError",
                "NotADirectoryError",
            }:
                raise ValueError("原生来源或引用文件不可用")
            raise HTTPException(
                503,
                {
                    "code": "native_result_unconfirmed",
                    "message": "原生操作尚未确认结果；不会自动重复执行",
                },
            )
        return result["result"]

    async def candidates(self, *, owner):
        result = await self.request(owner, "agent_sources.candidates", {})
        return result["candidates"]

    async def location(self, body, *, owner):
        result = await self.request(
            owner,
            "agent_sources.validate",
            {
                "agent_id": body.agent_id,
                "root": body.root,
                "endpoint": body.endpoint,
            },
        )
        return result["root"], result["endpoint"]

    async def attachment(self, roots, reference, *, owner):
        for root in roots:
            try:
                value = await self.request(
                    owner,
                    "agent_sources.attachment",
                    {
                        "root": root,
                        "reference": reference,
                    },
                )
                return base64.b64decode(value["content_base64"], validate=True), value["filename"]
            except ValueError:
                continue
        raise ValueError("原生附件不可用")
