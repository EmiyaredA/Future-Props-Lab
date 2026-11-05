"""Run-scoped MCP relay shared by task owners."""

import asyncio
import json
import os
import secrets
import sys
import tempfile
from contextlib import suppress
from pathlib import Path

from studio.config.settings import REPO_ROOT

from .conversation import recorded_result


class ToolRelay:
    def __init__(self, definitions, call, emit, *, timeout=120):
        self.definitions, self.call, self.emit = definitions, call, emit
        self.timeout = timeout
        self.server = None
        self.directory = None
        self.token = secrets.token_urlsafe(32)
        self.closed = False
        self.connections = set()
        self.handlers = set()

    async def start(self):
        # The short socket directory is an unconfigurable, process-owned system temporary.
        self.directory = tempfile.TemporaryDirectory(prefix="fpl-tools-")
        os.chmod(self.directory.name, 0o700)
        socket_path = str(Path(self.directory.name) / "s")

        async def handle(reader, writer):
            task = asyncio.current_task()
            self.handlers.add(task)
            self.connections.add(writer)
            call_id = None
            try:
                data = json.loads(await asyncio.wait_for(reader.readline(), 10))
                if self.closed or not secrets.compare_digest(data.get("token", ""), self.token):
                    raise ValueError("invalid task token")
                call_id = secrets.token_hex(12)
                await self.emit(
                    "tool_call",
                    {
                        "tool_call_id": call_id,
                        "tool_name": data["name"],
                        "arguments": data.get("arguments", {}),
                    },
                )
                result = await self.call(data["name"], data.get("arguments", {}))
                response = {"result": result}
                await self.emit(
                    "tool_result",
                    {
                        "tool_call_id": call_id,
                        "name": data["name"],
                        "status": "completed",
                        "result": recorded_result(result),
                    },
                )
            except asyncio.CancelledError:
                writer.close()
                self.connections.discard(writer)
                self.handlers.discard(task)
                raise
            except Exception:
                response = {"error": "工具失败；请检查权限、参数与资源当前状态，不要重试未知写入"}
                if call_id:
                    with suppress(Exception):
                        await self.emit(
                            "tool_result",
                            {
                                "tool_call_id": call_id,
                                "name": data.get("name", ""),
                                "status": "failed",
                                "result": response,
                            },
                        )
            try:
                writer.write(json.dumps(response, ensure_ascii=False).encode() + b"\n")
                await writer.drain()
            except (ConnectionError, OSError):
                pass
            finally:
                self.connections.discard(writer)
                self.handlers.discard(task)
                writer.close()
                try:
                    await writer.wait_closed()
                except (ConnectionError, OSError):
                    pass

        self.server = await asyncio.start_unix_server(
            handle, path=socket_path, limit=2 * 1024 * 1024
        )
        os.chmod(socket_path, 0o600)
        if getattr(sys, "frozen", False):
            command = str(Path(sys.executable).resolve().parent.parent / "fpl" / "fpl")
            args = ["mcp", "relay"]
        else:
            command = sys.executable
            args = [str(REPO_ROOT / "scripts/website/cli.py"), "mcp", "relay"]
        return {
            "mcpServers": {
                "fpl": {
                    "command": command,
                    "args": args,
                    "env": {
                        "FPL_TOOL_SOCKET": socket_path,
                        "FPL_TOOL_TOKEN": self.token,
                        "FPL_TOOL_TIMEOUT": str(self.timeout),
                        "FPL_TOOL_DEFINITIONS": json.dumps(self.definitions),
                    },
                }
            }
        }

    async def close(self):
        self.closed = True
        self.token = secrets.token_urlsafe(32)
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        handlers = list(self.handlers)
        for task in handlers:
            task.cancel()
        await asyncio.gather(*handlers, return_exceptions=True)
        for writer in list(self.connections):
            writer.close()
        if self.directory:
            self.directory.cleanup()
