"""Names and minimum probe contracts shared by service and Mac CLI consumers."""

from dataclasses import dataclass

from fpl_runtime.agent_ids import AgentId as AgentId


@dataclass(frozen=True)
class AgentDefinition:
    id: str
    name: str
    binary: str
    minimum: tuple[int, int, int]
    auth_args: tuple[str, ...]


DEFINITIONS = {
    "codex": AgentDefinition("codex", "Codex", "codex", (0, 163, 0), ("login", "status")),
    "claude-code": AgentDefinition(
        "claude-code", "Claude Code", "claude", (2, 1, 259), ("auth", "status")
    ),
    "opencode": AgentDefinition("opencode", "OpenCode", "opencode", (1, 19, 4), ("auth", "list")),
    "dsh": AgentDefinition("dsh", "DeepSeek Harness", "dsh", (0, 2, 1), ()),
    "pi": AgentDefinition("pi", "Pi", "pi", (1, 4, 0), ("auth", "check", "--json", "--no-refresh")),
}
