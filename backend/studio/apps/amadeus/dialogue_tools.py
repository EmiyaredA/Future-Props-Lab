"""Tools available to an owned CLI turn, with all mutations behind approval."""

from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from uuid import uuid4

from studio.contracts.amadeus.amadeus_native import DialogueToolResult
from studio.contracts.amadeus.conversations import ActionOut, QuestionIn, QuestionOut, RunOut
from studio.contracts.amadeus.tools import validate_tool
from studio.runtime.database.operation_receipts import OperationError


class TurnRecords(Protocol):
    async def require_running(self) -> None: ...
    async def ask(self, question: QuestionIn) -> QuestionOut: ...
    async def propose(self, name: str, arguments: dict) -> ActionOut: ...


class TurnFiles(Protocol):
    async def list(self) -> list[dict]: ...
    async def read(self, kind: str, name: str) -> Any: ...
    async def read_skill(self, identity: str, version: str, path: str) -> dict: ...


class DialogueTools:
    def __init__(
        self,
        run: RunOut,
        skills,
        *,
        may_write: bool,
        records: TurnRecords,
        files: TurnFiles,
        catalog: Callable[[str], list[dict]],
        operation_method: Callable[[str, dict], str],
        read_operation: Callable[[str, dict], Awaitable[dict]],
    ):
        self.run, self.skills, self.may_write = run, skills, may_write
        self.records, self.files, self.catalog = records, files, catalog
        self.operation_method, self.read_operation = operation_method, read_operation

    async def integrations(self):
        items = []
        for value in self.run.capabilities:
            if value.startswith("toolapi:"):
                args = {"path_params": {"integration_id": value.removeprefix("toolapi:")}}
                details = await self.read_operation("integrations.tool_api", args)
                items.append(details["result"])
            elif value.startswith("mcp:"):
                args = {"path_params": {"integration_id": value.removeprefix("mcp:")}}
                server = await self.read_operation("integrations.mcp_server", args)
                tools = await self.read_operation("integrations.mcp_tools", args)
                items.append({"id": value, "server": server["result"], "tools": tools["result"]})
        return {"items": items}

    async def call(self, name, args):
        validate_tool(name, args)
        await self.records.require_running()

        if name == "present_artifact":
            return DialogueToolResult(result=args)
        if name == "operations":
            resource = args.get("resource", "")
            values = self.catalog(resource)
            if not resource:
                keys = ("id", "resource", "method", "summary")
                values = [{key: item[key] for key in keys} for item in values]
            return DialogueToolResult(result={"items": values})
        if name == "files":
            return DialogueToolResult(result=await self.files.list())
        if name == "read_file":
            return DialogueToolResult(result=await self.files.read(args["kind"], args["name"]))
        if name == "skill":
            return DialogueToolResult(result=await self.read_skill(args))
        if name == "integrations":
            return DialogueToolResult(result=await self.integrations())
        if name == "ask_user":
            question = await self.records.ask(QuestionIn(tool_call_id=uuid4().hex, **args))
            return DialogueToolResult(result=question.model_dump(mode="json"), paused=True)
        if name == "call":
            operation, arguments = args["operation"], args["arguments"]
            method = self.operation_method(operation, arguments)
            if method == "GET":
                return DialogueToolResult(result=await self.read_operation(operation, arguments))
            action_name = "fpl_operation:" + operation
        elif name == "write_file":
            action_name, arguments = "write_work_file", args
        else:
            action_name, arguments = self.integration_proposal(args)
        return await self.propose(action_name, arguments)

    async def read_skill(self, args):
        skill_id = args["id"]
        snapshot = self.skills.get(skill_id)
        if snapshot is None:
            raise OperationError("Skill 未选择或未固定到本次运行", "unsupported_tool", 403)
        if not args.get("path"):
            return snapshot
        if args.get("version") != snapshot["version"]:
            raise OperationError("Skill 版本与运行快照不符", "unsupported_tool", 403)
        return await self.files.read_skill(skill_id, args["version"], args["path"])

    def integration_proposal(self, args):
        identity = args["id"]
        if identity not in self.run.capabilities or not identity.startswith(("mcp:", "toolapi:")):
            raise OperationError("集成未选择", "unsupported_tool", 403)
        if identity.startswith("mcp:"):
            if not args.get("tool"):
                raise OperationError("MCP 工具名缺失", "invalid_arguments")
            name = identity + ":" + args["tool"]
        else:
            name = "tool_api:" + identity.removeprefix("toolapi:")
        return name, {"input": args["input"], "revision": args["revision"]}

    async def propose(self, name, arguments):
        if self.run.mode != "agent" or not self.may_write:
            raise OperationError("当前运行只读", "write_tool_forbidden", 403)
        action = await self.records.propose(name, arguments)
        return DialogueToolResult(
            result={"waiting_approval": action.model_dump(mode="json")}, paused=True
        )
