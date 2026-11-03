"""Lease-only byte transfer on the authenticated outbound Models loopback channel."""

import asyncio
import hashlib
import os
from uuid import uuid4

from fpl_runtime.model_outputs import ModelOutputDescription

from .transport import LeaseEnded, NativeTransport, ProtocolConflict


class ModelsTransport(NativeTransport):
    def __init__(self, **values):
        super().__init__(service="models", **values)

    async def download_reference(self, lease, target):
        payload = lease.payload
        if target.is_symlink():
            raise ValueError("原生参考不能是符号链接")
        temporary = target.with_name(uuid4().hex + ".tmp")
        size, checksum = 0, hashlib.sha256()
        try:
            async with self.client.stream(
                "GET",
                f"_native/v1/inputs/{lease.job_id}/{lease.lease_id}",
                headers={"Accept-Encoding": "identity"},
            ) as response:
                if response.status_code in {403, 410}:
                    raise LeaseEnded("原生输入授权已结束")
                response.raise_for_status()
                if response.headers.get("content-encoding", "identity").lower() not in {
                    "",
                    "identity",
                }:
                    raise ProtocolConflict("原生输入不接受压缩")
                if (
                    int(response.headers.get("content-length", "-1"))
                    != payload["reference_byte_size"]
                ):
                    raise ProtocolConflict("原生参考长度不匹配")
                with temporary.open("xb") as output:
                    async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                        size += len(chunk)
                        if size > payload["reference_byte_size"]:
                            raise ProtocolConflict("原生参考超过声明大小")
                        checksum.update(chunk)
                        output.write(chunk)
            if (
                size != payload["reference_byte_size"]
                or checksum.hexdigest() != payload["reference_sha256"]
            ):
                raise ProtocolConflict("原生参考摘要不匹配")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    async def upload_result(self, lease, source, document):
        description = ModelOutputDescription(**document)
        observed = await asyncio.to_thread(
            ModelOutputDescription.from_file, source, "result.wav", "audio/wav"
        )
        if observed != description:
            raise ProtocolConflict("原生结果与持久回执不匹配")

        async def chunks():
            with source.open("rb") as input_file:
                while chunk := await asyncio.to_thread(input_file.read, 1024 * 1024):
                    yield chunk

        from contextlib import aclosing

        async with aclosing(chunks()) as content:
            response = await self.client.post(
                f"_native/v1/outputs/{lease.job_id}/{lease.lease_id}",
                headers={
                    "Content-Length": str(description.byte_size),
                    "X-Model-Output-Descriptor": description.header(),
                    "Content-Type": "application/octet-stream",
                },
                content=content,
                timeout=600,
            )
        if response.status_code in {403, 410}:
            raise LeaseEnded("原生结果租约已结束")
        if response.status_code in {409, 422}:
            raise ProtocolConflict("原生结果与服务回执冲突")
        response.raise_for_status()
        if response.json().get("stored") is not True:
            raise ProtocolConflict("原生结果未取得持久确认")
