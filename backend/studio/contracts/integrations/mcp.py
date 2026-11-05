"""Provider-neutral MCP discovery and invocation data."""

from dataclasses import dataclass
from typing import Any, Protocol


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
    """Discovery may be retried; a timed-out call has an unknown external outcome.

    The caller verifies ownership, enabled revision and approval before calling.
    Adapters close the transport on cancellation and never retry a submitted action.
    """

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
    ) -> dict[str, Any]: ...
