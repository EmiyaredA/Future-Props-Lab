"""Run a fixed CLI connection with Amadeus tools supplied by its owner service."""

import asyncio
import os
from pathlib import Path
from time import monotonic
from uuid import UUID, uuid4

import httpx
from cryptography.fernet import Fernet

from studio.apps.amadeus.storage.files import work_root
from studio.config import read_config
from studio.config.settings import Settings
from studio.contracts.agent_workbench.native import NativeOutcome
from studio.contracts.amadeus.amadeus_native import DialoguePlan, DialogueScope
from studio.contracts.amadeus.tools import TOOLS
from studio.host.agent_execution.cli.catalog import (
    DEFINITIONS,
    connection,
    execution_signature,
    inspect_connection,
)
from studio.host.agent_execution.cli.dialogue import run_dialogue
from studio.host.transport import LeaseEnded, ProtocolConflict
from studio.runtime.database.operation_receipts import OperationError


class AgentConnections:
    def __init__(self, config, runtime_root):
        self.config, self.runtime_root = config, runtime_root.resolve(strict=True)
        if runtime_root.is_symlink() or not self.runtime_root.is_dir():
            raise ValueError("Agent Runtime 配置档案目录无效")
        # Settings validates a Fernet key even for this read-only CLI snapshot.
        # Keep this ephemeral and separate from any persisted encryption domain.
        self.settings_key = Fernet.generate_key().decode("ascii")

    def settings(self):
        values = {
            key: value
            for key, value in read_config(self.config).items()
            if key.startswith("fpl_code_agents_")
        }
        return Settings(
            _config_file=None,
            _read_environment=False,
            fpl_database_path=str(self.runtime_root / "connection-path.db"),
            fpl_secrets_key=self.settings_key,
            **values,
        )

    def available(self):
        settings = self.settings()
        result = {}
        for agent in DEFINITIONS:
            enabled, executable, error = connection(settings, agent)
            if (
                enabled
                and not error
                and executable
                and Path(executable).is_file()
                and os.access(executable, os.X_OK)
            ):
                result[agent] = execution_signature(agent, executable)
        return result

    async def resolve(self, scope, *, probe):
        settings = self.settings()
        enabled, executable, error = connection(settings, scope.agent)
        if (
            not enabled
            or error
            or not executable
            or execution_signature(scope.agent, executable) != scope.signature
        ):
            raise OperationError("Agent 连接已禁用或发生变化", "agent_unavailable", 409)
        if probe:
            status = await inspect_connection(settings, scope.agent, discover_models=False)
            if not status["available"]:
                raise OperationError(status["message"], "agent_unavailable", 409)
        return executable


class DialogueWorker:
    def __init__(self, transport, files_root, connections, *, runner=run_dialogue):
        self.transport, self.files_root, self.connections, self.runner = (
            transport,
            files_root,
            connections,
            runner,
        )

    async def execute(self, lease):
        if self.connections is None:
            return NativeOutcome(status="failed", error_code="agent_unavailable")
        payload = {"lease": lease.model_dump(mode="json")}
        try:
            scope = DialogueScope.model_validate(lease.payload)
            owner = str(UUID(lease.owner_user_id))
            if owner != lease.owner_user_id:
                raise ValueError("invalid account ID")
            values = await self.transport.post("dialogue/plan", payload)
            plan = DialoguePlan.model_validate(values)
            executable = await self.connections.resolve(scope, probe=True)
            root = work_root(owner, str(scope.conversation_id), files_root=self.files_root)
            if root.resolve() != root or not root.is_dir():
                raise OperationError("会话工作目录不可用", "folder_missing", 409)
            pulse = await self.transport.post("heartbeat", payload)
            if pulse.get("active") is not True:
                raise LeaseEnded("对话授权已失效")
        except OperationError as exc:
            return NativeOutcome(status="failed", error_code=exc.code, message=str(exc)[:1000])
        except (ValueError, LeaseEnded, OSError, httpx.HTTPError, ProtocolConflict):
            return NativeOutcome(status="failed", error_code="agent_unavailable")

        turn = DialogueChannel(self.transport, payload)

        async def watch():
            while True:
                await asyncio.sleep(1)
                pulse = await self.transport.post("heartbeat", payload)
                if pulse.get("active") is not True:
                    raise LeaseEnded("对话授权已失效")
                await self.connections.resolve(scope, probe=False)

        process = asyncio.create_task(
            self.runner(
                scope.agent,
                executable,
                scope.model,
                plan.prompt,
                TOOLS,
                turn.call,
                turn.emit,
                root=root,
                runtime_path=self.connections.runtime_root,
            )
        )
        watcher = asyncio.create_task(watch())
        paused = asyncio.create_task(turn.paused.wait())
        try:
            async with asyncio.timeout(900):
                done, _ = await asyncio.wait(
                    (process, watcher, paused), return_when=asyncio.FIRST_COMPLETED
                )
                if paused not in done:
                    if watcher in done:
                        await watcher
                    await process
                    await turn.flush()
            return NativeOutcome(status="completed")
        except (
            TimeoutError,
            OSError,
            httpx.HTTPError,
            OperationError,
            LeaseEnded,
            ProtocolConflict,
        ):
            return NativeOutcome(status="unknown", error_code="dialogue_outcome_unconfirmed")
        except Exception:
            return NativeOutcome(status="failed", error_code="agent_execution_failed")
        finally:
            for task in (process, watcher, paused):
                if not task.done():
                    task.cancel()
            await asyncio.gather(process, watcher, paused, return_exceptions=True)


class DialogueChannel:
    def __init__(self, transport, payload):
        self.transport, self.payload = transport, payload
        self.paused, self.lock = asyncio.Event(), asyncio.Lock()
        self.pending, self.last = [], float("-inf")

    async def send(self, kind, payload):
        result = await self.transport.post(
            "dialogue/event",
            {
                **self.payload,
                "event": {
                    "kind": kind,
                    "payload": payload,
                    "idempotency_key": uuid4().hex,
                },
            },
        )
        if result.get("accepted") is not True:
            raise ProtocolConflict("对话事件未确认")

    async def flush_pending(self):
        if self.pending:
            text = "".join(self.pending)
            self.pending.clear()
            await self.send("assistant_delta", {"text": text})
            self.last = monotonic()

    async def flush(self):
        async with self.lock:
            if not self.paused.is_set():
                await self.flush_pending()

    async def emit(self, kind, payload):
        async with self.lock:
            if self.paused.is_set():
                return
            if kind == "assistant_delta":
                if text := payload.get("text"):
                    self.pending.append(text)
                    if monotonic() - self.last >= 0.15:
                        await self.flush_pending()
                return
            await self.flush_pending()
            await self.send(kind, payload)

    async def call(self, name, arguments):
        async with self.lock:
            if self.paused.is_set():
                raise OperationError("对话已暂停", "run_not_active", 409)
            await self.flush_pending()
            result = await self.transport.post(
                "dialogue/tool", {**self.payload, "tool": {"name": name, "arguments": arguments}}
            )
            if result.get("ok") is not True:
                raise OperationError(
                    result.get("message", "任务工具不可用"), result.get("code", "unsupported_tool")
                )
            if result.get("paused") is True:
                self.paused.set()
            return result["result"]
