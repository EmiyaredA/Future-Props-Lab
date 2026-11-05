from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from studio.config.settings import Settings
from studio.runtime.http.outbound_urls import require_safe_integration_http_url


@dataclass(frozen=True)
class DiscoveredTool:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class DiscoveryResult:
    server_name: str
    server_version: str
    protocol_version: str
    tools: tuple[DiscoveredTool, ...]


class McpDiscoveryClient(Protocol):
    async def discover(
        self,
        *,
        transport: str,
        url: str,
        command: str,
        arguments: list[str],
        bearer_token: str,
        environment: dict[str, str],
    ) -> DiscoveryResult: ...


class OfficialMcpDiscoveryClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _stdio_command(self, command: str) -> Path:
        path = Path(command)
        if not path.is_absolute():
            raise ValueError("stdio 命令必须是绝对路径")
        resolved = path.resolve()
        if resolved not in self.settings.mcp_stdio_allowed_commands:
            raise ValueError("stdio 命令未加入 FPL_MCP_STDIO_ALLOWED_COMMANDS 白名单")
        if not resolved.is_file():
            raise ValueError("stdio 命令不存在")
        return resolved

    @staticmethod
    def _result(client: Any, tools: list[Any]) -> DiscoveryResult:
        info = getattr(client, "server_info", None)
        return DiscoveryResult(
            server_name=str(getattr(info, "name", "") or ""),
            server_version=str(getattr(info, "version", "") or ""),
            protocol_version=str(getattr(client, "protocol_version", "") or ""),
            tools=tuple(
                DiscoveredTool(
                    name=str(tool.name),
                    description=str(getattr(tool, "description", "") or ""),
                    input_schema=dict(
                        getattr(tool, "input_schema", None)
                        or getattr(tool, "inputSchema", None)
                        or {}
                    ),
                )
                for tool in tools
            ),
        )

    @staticmethod
    async def _all_tools(client: Any) -> list[Any]:
        tools: list[Any] = []
        cursor: str | None = None
        while True:
            page = await client.list_tools(cursor=cursor)
            tools.extend(page.tools)
            cursor = page.next_cursor
            if not cursor:
                return tools

    async def discover(
        self,
        *,
        transport: str,
        url: str,
        command: str,
        arguments: list[str],
        bearer_token: str,
        environment: dict[str, str],
    ) -> DiscoveryResult:
        from mcp import Client

        if transport == "streamable_http":
            import httpx2
            from mcp.client.streamable_http import streamable_http_client

            safe_url = await require_safe_integration_http_url(url)
            headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
            timeout = httpx2.Timeout(30.0, connect=10.0)
            async with httpx2.AsyncClient(
                headers=headers,
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,
            ) as http_client:
                async with Client(
                    streamable_http_client(safe_url, http_client=http_client)
                ) as client:
                    return self._result(client, await self._all_tools(client))

        from mcp.client.stdio import StdioServerParameters, stdio_client

        executable = self._stdio_command(command)
        parameters = StdioServerParameters(
            command=str(executable),
            args=list(arguments),
            env=dict(environment),
        )
        async with Client(stdio_client(parameters)) as client:
            return self._result(client, await self._all_tools(client))

    async def call(
        self,
        *,
        transport: str,
        url: str,
        command: str,
        arguments: list[str],
        bearer_token: str,
        environment: dict[str, str],
        tool_name: str,
        tool_arguments: dict[str, Any],
    ) -> dict[str, Any]:
        from mcp import Client

        if transport == "streamable_http":
            import httpx2
            from mcp.client.streamable_http import streamable_http_client

            safe_url = await require_safe_integration_http_url(url)
            headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
            async with httpx2.AsyncClient(
                headers=headers,
                timeout=httpx2.Timeout(30.0, connect=10.0),
                follow_redirects=False,
                trust_env=False,
            ) as http_client:
                async with Client(
                    streamable_http_client(safe_url, http_client=http_client)
                ) as client:
                    result = await client.call_tool(tool_name, tool_arguments)
                    return result.model_dump(mode="json")

        from mcp.client.stdio import StdioServerParameters, stdio_client

        executable = self._stdio_command(command)
        parameters = StdioServerParameters(
            command=str(executable), args=list(arguments), env=dict(environment)
        )
        async with Client(stdio_client(parameters)) as client:
            result = await client.call_tool(tool_name, tool_arguments)
            return result.model_dump(mode="json")
