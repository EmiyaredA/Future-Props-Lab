"""Bind website action effects to the authorized request and application."""

from functools import partial

from studio.apps.amadeus.clients.website_operations import call_operation
from studio.apps.amadeus.storage.files import write_file
from studio.apps.integrations.transport.bindings import mcp_catalog, tool_catalog
from studio.host.agent_execution.amadeus_scripts import run_script
from studio.runtime.tasks.blocking_io import run_blocking_io


class WebsiteActionEffects:
    def __init__(self, sessions, files_root, video):
        self.sessions, self.files_root, self.video = sessions, files_root, video

    def bind(self, request, owner, conversation, output=None):
        operation = partial(call_operation, request.app, request.headers, allow_write=True)

        async def effect(action):
            name, args = action.tool_name, action.arguments
            if name.startswith(("tool_api:", "mcp:")):
                async with self.sessions(info={"owner_user_id": owner}) as session:
                    if name.startswith("tool_api:"):
                        return await tool_catalog(request, session, owner).execute(
                            name.removeprefix("tool_api:"), args.get("input", {}), args["revision"]
                        )
                    _, integration, tool = name.split(":", 2)
                    return await mcp_catalog(request, session, owner).execute(
                        integration, tool, args.get("input", {}), args["revision"]
                    )
            if name in {"write_script", "write_work_file"}:
                content = args.get("content")
                if not isinstance(content, str):
                    raise ValueError("脚本内容无效")
                return await run_blocking_io(
                    write_file,
                    owner,
                    conversation,
                    "scripts" if name == "write_script" else "outputs",
                    str(args.get("name", "")),
                    content.encode(),
                    str(args.get("expected_sha256", "")),
                    files_root=self.files_root,
                )
            if name == "video_timeline_batch":
                return await self.video(owner, action.id, str(args.get("project_id", "")), args)
            if name.startswith("fpl_operation:"):
                return await operation(name.removeprefix("fpl_operation:"), args)
            return await run_script(owner, conversation, args, output, files_root=self.files_root)

        return effect
