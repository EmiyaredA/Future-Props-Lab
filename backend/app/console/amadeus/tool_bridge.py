"""Run-scoped MCP tool bridge; browser credentials stay only in this parent process."""

import asyncio
import secrets
from pathlib import Path

import httpx
from jsonschema import ValidationError, validate

from app.console.amadeus.conversations import Conversations
from app.console.amadeus.files import list_files, read_file_bytes
from app.console.amadeus.fpl_operations import call_operation, operation_catalog
from app.console.amadeus.questions import Questions
from app.console.amadeus.runs import Runs
from app.console.amadeus.schemas import ActionIn, QuestionIn
from app.console.amadeus.skills import read_skill_file
from app.console.governance.code_agents import resolve
from app.runtime.operation_receipts import OperationError
from app.runtime.ownership import bind_owner


def definition(name, description, properties=None, required=()):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties or {},
            "required": list(required),
            "additionalProperties": False,
        },
    }


TOOLS = [
    definition(
        "operations",
        "Discover registered operations; filter resource to get full request schemas",
        {"resource": {"type": "string"}},
    ),
    definition(
        "present_artifact",
        "Present a plan or draft as an editable review card; this does not execute it",
        {
            "kind": {"type": "string", "enum": ["plan", "draft"]},
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "body": {"type": "string", "minLength": 1, "maxLength": 100000},
            "steps": {
                "type": "array",
                "maxItems": 30,
                "items": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                    "required": ["title", "detail"],
                    "additionalProperties": False,
                },
            },
        },
        ("kind", "title", "body", "steps"),
    ),
    definition(
        "call",
        "Read or propose a registered project operation. "
        "Writes require owner approval; stop after a proposal.",
        {"operation": {"type": "string"}, "arguments": {"type": "object"}},
        ("operation", "arguments"),
    ),
    definition("files", "List this conversation's files and hashes"),
    definition(
        "read_file",
        "Read a conversation UTF-8 file or view an image",
        {"kind": {"type": "string"}, "name": {"type": "string"}},
        ("kind", "name"),
    ),
    definition(
        "write_file",
        "Propose writing an output file. Requires approval and the existing SHA256 on replacement.",
        {
            "name": {"type": "string"},
            "content": {"type": "string"},
            "expected_sha256": {"type": "string"},
        },
        ("name", "content"),
    ),
    definition(
        "ask_user",
        "Ask the owner a question, then stop this turn",
        {
            "prompt": {"type": "string"},
            "options": {"type": "array", "items": {"type": "string"}},
            "allow_text": {"type": "boolean"},
        },
        ("prompt",),
    ),
    definition(
        "skill",
        "Load an explicitly selected Skill or read one of its UTF-8 files",
        {"id": {"type": "string"}, "version": {"type": "string"}, "path": {"type": "string"}},
        ("id",),
    ),
    definition("integrations", "List explicitly selected Tool API and MCP capabilities"),
    definition(
        "integration",
        "Propose invoking a selected integration. Requires revision and owner approval.",
        {
            "id": {"type": "string"},
            "tool": {"type": "string"},
            "revision": {"type": "integer"},
            "input": {"type": "object"},
        },
        ("id", "revision", "input"),
    ),
]


class ToolBridge:
    def __init__(self, app, headers, principal, run, sessions):
        self.app, self.headers, self.principal = app, headers, principal
        self.run, self.sessions = run, sessions
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
        if name not in {t["name"] for t in TOOLS} or not isinstance(args, dict):
            raise OperationError("工具参数无效")
        try:
            validate(args, next(t["inputSchema"] for t in TOOLS if t["name"] == name))
        except ValidationError:
            raise OperationError("工具参数与契约不匹配", "invalid_arguments", 422) from None
        # All reads also reauthenticate through the official session boundary.
        await self.api(f"/v1/amadeus/conversations/{self.run.conversation_id}")
        async with self.sessions() as session:
            bind_owner(session, self.principal.owner_user_id)
            await resolve(
                session,
                self.run.owner_user_id,
                self.run.user_id,
                self.run.agent_id,
                "amadeus",
                probe=False,
            )
            row = await Runs(session, self.principal).get(self.run.conversation_id, self.run.id)
            if row.status != "running":
                raise OperationError("运行已停止或等待确认", "run_not_active", 409)
            operations = operation_catalog(self.app)
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
            if name == "files":
                return list_files(row.owner_user_id, row.conversation_id)
            if name == "read_file":
                import base64

                data = read_file_bytes(
                    row.owner_user_id, row.conversation_id, args["kind"], args["name"]
                )
                if len(data) > 1024 * 1024:
                    raise OperationError("文件过大，请使用文件下载接口")
                suffix = Path(args["name"]).suffix.lower()
                if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
                    mime = {
                        ".png": "image/png",
                        ".jpg": "image/jpeg",
                        ".jpeg": "image/jpeg",
                        ".webp": "image/webp",
                    }[suffix]
                    return [
                        {"type": "image", "data": base64.b64encode(data).decode(), "mimeType": mime}
                    ]
                return {"content": data.decode("utf-8")}
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
            )
            await Runs(session, self.principal).pause_for_approval(row.conversation_id, row.id)
            self.paused.set()
            return {"waiting_approval": action.model_dump(mode="json")}
