"""Run-scoped MCP tool bridge; browser credentials stay only in this parent process."""

import asyncio
import secrets

import httpx

from studio.apps.amadeus.clients.website_operations import call_operation
from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.dialogue_files import DialogueFiles
from studio.apps.amadeus.storage.questions import Questions
from studio.apps.amadeus.storage.runs import RunRecords as Runs
from studio.apps.amadeus.storage.skill_import import read_skill_file
from studio.contracts.amadeus.conversations import ActionIn, QuestionIn
from studio.contracts.amadeus.tools import TOOLS as TOOLS
from studio.contracts.amadeus.tools import validate_tool
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.ownership import bind_owner


class ToolBridge:
    def __init__(
        self,
        app,
        headers,
        principal,
        run,
        sessions,
        *,
        files_root,
        resolve_agent,
        operation_catalog,
    ):
        self.app, self.headers, self.principal = app, headers, principal
        self.run, self.sessions = run, sessions
        self.files_root = files_root
        self.resolve_agent = resolve_agent
        self.operation_catalog = operation_catalog
        self.paused = asyncio.Event()
        self.closed = False

    def close(self):
        self.closed = True

    async def api(self, path):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url="http://fpl-internal",
            headers=self.headers,
        ) as client:
            response = await client.get(path)
            if response.is_error:
                raise OperationError("会话授权或资源已失效", "authorization_changed", 403)
            return response.json()

    async def call(self, name, args):
        if self.closed:
            raise OperationError("任务工具授权已失效", "run_not_active", 409)
        validate_tool(name, args)
        # All reads also reauthenticate through the official session boundary.
        await self.api(f"/v1/amadeus/conversations/{self.run.conversation_id}")
        async with self.sessions() as session:
            bind_owner(session, self.principal.owner_user_id)
            await self.resolve_agent(
                session,
                self.run.owner_user_id,
                self.run.user_id,
                self.run.agent_id,
                probe=False,
            )
            row = await Runs(session, self.principal).get(self.run.conversation_id, self.run.id)
            if row.status != "running":
                raise OperationError("运行已停止或等待确认", "run_not_active", 409)
            operations = self.operation_catalog()
            if name == "present_artifact":
                return args
            if name == "operations":
                resource = args.get("resource", "")
                return {
                    "items": [
                        op
                        if resource
                        else {k: op[k] for k in ("id", "resource", "method", "summary")}
                        for op in operations
                        if not resource or op["resource"] == resource
                    ]
                }
            if name in {"files", "read_file"}:
                files = DialogueFiles(row.owner_user_id, row.conversation_id, self.files_root)
                await session.rollback()
                if name == "files":
                    return await files.list()
                return await files.read(args["kind"], args["name"])
            if name == "skill":
                identity = args["id"]
                if f"skill:{identity}" not in row.capabilities_json:
                    raise OperationError("Skill 未选择", "unsupported_tool", 403)
                snapshot = row.execution_config.get("skills", {}).get(identity)
                if not snapshot:
                    raise OperationError("Skill 未固定到本次运行", "unsupported_tool", 403)
                if args.get("path") and args.get("version") != snapshot["version"]:
                    raise OperationError("Skill 版本与运行快照不符", "unsupported_tool", 403)
                if args.get("path"):
                    return read_skill_file(
                        row.owner_user_id,
                        row.conversation_id,
                        identity,
                        args["version"],
                        args["path"],
                        files_root=self.files_root,
                    )
                return snapshot
            if name == "integrations":
                selected = list(row.capabilities_json)
                await session.rollback()
                items = []
                for identity in selected:
                    if identity.startswith("toolapi:"):
                        items.append(await self.api(f"/v1/integrations/tool-apis/{identity[8:]}"))
                    elif identity.startswith("mcp:"):
                        items.append(
                            {
                                "id": identity,
                                "server": await self.api(f"/v1/integrations/mcp/{identity[4:]}"),
                                "tools": await self.api(
                                    f"/v1/integrations/mcp/{identity[4:]}/tools"
                                ),
                            }
                        )
                return {"items": items}
            if name == "ask_user":
                question = await Questions(session, self.principal).create(
                    row.conversation_id,
                    row.id,
                    QuestionIn(tool_call_id=secrets.token_hex(8), **args),
                )
                self.paused.set()
                return question.model_dump(mode="json")
            if name == "call":
                identity = args["operation"]
                entry = next((op for op in operations if op["id"] == identity), None)
                if entry is None:
                    raise OperationError("操作未登记")
                if entry["method"] == "GET":
                    await session.rollback()
                    return await call_operation(
                        self.app, self.headers, identity, args["arguments"], allow_write=False
                    )
                action_name, arguments = f"fpl_operation:{identity}", args["arguments"]
            elif name == "write_file":
                action_name, arguments = "write_work_file", args
            elif name == "integration":
                identity = args["id"]
                if identity not in row.capabilities_json or not identity.startswith(
                    ("mcp:", "toolapi:")
                ):
                    raise OperationError("集成未选择", "unsupported_tool", 403)
                action_name = (
                    f"mcp:{identity[4:]}:{args['tool']}"
                    if identity.startswith("mcp:")
                    else f"tool_api:{identity[8:]}"
                )
                arguments = {"input": args["input"], "revision": args["revision"]}
            else:
                raise OperationError("工具不可用")
            if row.mode == "plan" or not self.principal.allows("content.write"):
                raise OperationError("当前运行只读", "write_tool_forbidden", 403)
            action = await Conversations(session, self.principal).propose(
                row.conversation_id,
                ActionIn(tool_name=action_name, arguments=arguments, run_id=row.id),
                commit=False,
            )
            await Runs(session, self.principal).pause_for_approval(row.conversation_id, row.id)
            self.paused.set()
            return {"waiting_approval": action.model_dump(mode="json")}
