"""Bounded Workbench project tools for the compatibility and Mac runners."""

import asyncio
import difflib
import json

from jsonschema import ValidationError, validate

from . import commands, project_files


def _tool(name, description, **properties):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": {
                key: {"type": "string", "maxLength": maximum} for key, maximum in properties.items()
            },
            "required": list(properties),
            "additionalProperties": False,
        },
    }


class ProjectTools:
    def __init__(self, authorize, approve, file_writes):
        self.authorize, self.approve = authorize, approve
        self.file_writes = file_writes
        self.tool_lock = asyncio.Lock()

    @staticmethod
    def definitions(project):
        read = _tool(
            "read_file", "Read a UTF-8 file. An optional line anchors the source preview.", path=500
        )
        read["inputSchema"]["properties"]["line"] = {
            "type": "integer",
            "minimum": 1,
            "maximum": 100_000,
        }
        options = [
            _tool(
                "list_files", "List a directory relative to this project; use . for root", path=500
            ),
            read,
            _tool(
                "write_file", "Propose a UTF-8 file write for approval", path=500, content=131072
            ),
        ]
        if commands.available() and project.commands:
            available = ", ".join(
                f"{key} ({value.label})" for key, value in project.commands.items()
            )
            options.append(
                _tool("run_command", f"Propose a preset for approval: {available}", preset=80)
            )
        return options

    async def call(self, name, args):
        async with self.tool_lock:
            project = await self.authorize()
            definition = next(
                (item for item in self.definitions(project) if item["name"] == name), None
            )
            if not definition:
                raise ValueError("工具未授权")
            try:
                validate(args, definition["inputSchema"])
            except ValidationError:
                raise ValueError("工具参数无效") from None
            if name == "run_command":
                preset = args["preset"]
                command = project.commands.get(preset)
                if command is None:
                    raise ValueError("命令预设不存在")

                async def execute(latest):
                    if latest != project or latest.commands.get(preset) != command:
                        raise ValueError("命令预设已变更")
                    return await commands.run_command(latest.root, command)

                return await self.approve(
                    "command", command.label, json.dumps(command.argv, ensure_ascii=False), execute
                )
            path = args["path"]
            if name == "list_files":
                return await asyncio.to_thread(
                    project_files.list_files,
                    project.root,
                    path,
                    expected_root=project.directory_key,
                )
            try:
                original = await asyncio.to_thread(
                    project_files.read_file, project.root, path, expected_root=project.directory_key
                )
            except (OSError, ValueError):
                raise ValueError("无法读取该项目文件") from None
            if name == "read_file":
                return {"path": path, "content": original}
            content = args["content"]
            if len(content.encode()) > project_files.MAX_FILE_BYTES or "\x00" in content:
                raise ValueError("文件不是受支持的文本")
            diff = "".join(
                difflib.unified_diff(
                    (original or "").splitlines(keepends=True),
                    content.splitlines(keepends=True),
                    fromfile=path if original is not None else "/dev/null",
                    tofile=path,
                )
            )
            if len(diff.encode()) > 64 * 1024:
                raise ValueError("修改过大，请拆分后重试")

            async def execute(latest):
                if latest != project:
                    raise ValueError("项目已变更")
                async with self.file_writes:
                    current = await self.authorize()
                    if current != latest:
                        raise ValueError("项目已变更")
                    write = asyncio.create_task(
                        asyncio.to_thread(
                            project_files.write_file,
                            latest.root,
                            path,
                            content,
                            project_files.digest(original),
                            expected_root=latest.directory_key,
                        )
                    )
                    try:
                        return await asyncio.shield(write)
                    except asyncio.CancelledError:
                        await asyncio.gather(write, return_exceptions=True)
                        raise

            return await self.approve("write", path, diff, execute)
