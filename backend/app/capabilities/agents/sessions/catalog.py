from pathlib import Path

from . import parsers
from .files import JsonlAdapter
from .opencode import OpenCodeAdapter, OpenCodeServerAdapter

NAMES = {
    "codex": "Codex",
    "claude-code": "Claude Code",
    "opencode": "OpenCode",
    "dsh": "DeepSeek Harness",
    "pi": "Pi",
}


def get_adapter(agent_id: str, endpoint: str = ""):
    if endpoint:
        if agent_id != "opencode":
            raise ValueError("当前版本只有 OpenCode 支持原生 HTTP 来源")
        return OpenCodeServerAdapter(endpoint)
    if agent_id == "opencode":
        return OpenCodeAdapter()
    parser = {
        "codex": parsers.codex,
        "claude-code": parsers.claude,
        "dsh": parsers.dsh,
        "pi": parsers.pi,
    }.get(agent_id)
    if parser is None:
        raise ValueError("未知 Agent")
    return JsonlAdapter(agent_id, parser)


def candidates(home: Path | None = None):
    home = home or Path.home()
    roots = [
        ("codex", ".codex", "Codex APP / CLI · 包含归档"),
        ("claude-code", ".claude/projects", "Claude Code APP / CLI"),
        (
            "claude-code",
            "Library/Application Support/Claude/local-agent-mode-sessions",
            "Claude Desktop Code 来源",
        ),
        (
            "claude-code",
            "Library/Application Support/Claude-3p/local-agent-mode-sessions",
            "Claude Desktop Code 备用来源",
        ),
        ("opencode", ".local/share/opencode", "OpenCode APP / CLI"),
        ("dsh", ".dsh/sessions", "DeepSeek Harness APP / CLI"),
        ("pi", ".pi/agent/sessions", "Pi 会话（可选择实际宿主目录）"),
    ]
    return [
        {
            "agent_id": agent,
            "label": label,
            "root": str(home / relative),
            "exists": (home / relative).is_dir(),
        }
        for agent, relative, label in roots
    ]
