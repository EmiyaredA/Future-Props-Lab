"""Tools available to an owned CLI turn, with all mutations behind approval."""

import base64
from functools import partial
from pathlib import Path
from uuid import uuid4

from anyio.to_thread import run_sync

from studio.apps.amadeus.clients.website_operations import catalog_from_schema, operation_request
from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.files import list_files, open_work_file
from studio.apps.amadeus.storage.questions import Questions
from studio.apps.amadeus.storage.runs import RunRecords
from studio.apps.amadeus.storage.skill_files import read_skill_file
from studio.apps.amadeus.transport.operation_http import published_catalog
from studio.contracts.amadeus.amadeus_native import DialogueToolResult
from studio.contracts.amadeus.conversations import ActionIn, QuestionIn
from studio.contracts.amadeus.tools import validate_tool
from studio.runtime.database.operation_receipts import OperationError

from .operation_calls import call_registered

IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def read_file(owner, conversation, root, kind, name):
    file, size = open_work_file(owner, conversation, kind, name, files_root=root)
    with file:
        if size > 1024 * 1024:
            raise OperationError("文件过大，请使用文件下载接口", "file_too_large", 422)
        data = file.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise OperationError("文件过大，请使用文件下载接口", "file_too_large", 422)
    mime = IMAGE_TYPES.get(Path(name).suffix.lower())
    if mime:
        return [{"type": "image", "data": base64.b64encode(data).decode(), "mimeType": mime}]
    try:
        return {"content": data.decode("utf-8")}
    except UnicodeDecodeError as exc:
        raise OperationError("文件不是 UTF-8 文本", "unsupported_file", 422) from exc


class DialogueTools:
    def __init__(self, database, capabilities, principal, run, assertion, path, skills):
        self.database, self.capabilities, self.principal = database, capabilities, principal
        self.run, self.assertion, self.path, self.skills = run, assertion, path, skills

    async def read_operation(self, operation, arguments):
        result = await call_registered(
            self.capabilities, self.assertion, self.path, operation, arguments, approved=False
        )
        return result

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
        conversation = self.run.conversation_id
        owner, root = self.principal.user_id, self.database.root
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await RunRecords(session, self.principal).get(conversation, self.run.id)
            if row.status != "running":
                raise OperationError("运行已停止或等待确认", "run_not_active", 409)
            await session.rollback()

        if name == "present_artifact":
            return DialogueToolResult(result=args)
        if name == "operations":
            resource = args.get("resource", "")
            values = catalog_from_schema(published_catalog(), resource)
            if not resource:
                keys = ("id", "resource", "method", "summary")
                values = [{key: item[key] for key in keys} for item in values]
            return DialogueToolResult(result={"items": values})
        if name == "files":
            return DialogueToolResult(
                result=await run_sync(partial(list_files, owner, conversation, files_root=root))
            )
        if name == "read_file":
            return DialogueToolResult(
                result=await run_sync(
                    read_file, owner, conversation, root, args["kind"], args["name"]
                )
            )
        if name == "skill":
            return DialogueToolResult(result=await self.read_skill(args))
        if name == "integrations":
            return DialogueToolResult(result=await self.integrations())
        if name == "ask_user":
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                question = await Questions(session, self.principal).create(
                    conversation, self.run.id, QuestionIn(tool_call_id=uuid4().hex, **args)
                )
            return DialogueToolResult(result=question.model_dump(mode="json"), paused=True)
        if name == "call":
            operation, arguments = args["operation"], args["arguments"]
            method, *_ = operation_request(operation, arguments, allow_write=True)
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
        return await run_sync(
            partial(
                read_skill_file,
                self.principal.user_id,
                self.run.conversation_id,
                skill_id,
                args["version"],
                args["path"],
                files_root=self.database.root,
            )
        )

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
        if self.run.mode != "agent" or not self.principal.allows("content.write"):
            raise OperationError("当前运行只读", "write_tool_forbidden", 403)
        async with self.database.sessions(
            info={"owner_user_id": self.principal.user_id}
        ) as session:
            conversation = self.run.conversation_id
            action = await Conversations(session, self.principal).propose(
                conversation,
                ActionIn(tool_name=name, arguments=arguments, run_id=self.run.id),
                commit=False,
            )
            await RunRecords(session, self.principal).pause_for_approval(conversation, self.run.id)
        return DialogueToolResult(
            result={"waiting_approval": action.model_dump(mode="json")}, paused=True
        )
