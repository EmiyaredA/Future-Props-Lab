"""Read-only native session discovery. No Agent process is started by this package."""

from .catalog import candidates, get_adapter
from .contracts import AgentId, Entry, ReadBatch, SessionInfo

__all__ = ["AgentId", "Entry", "ReadBatch", "SessionInfo", "candidates", "get_adapter"]
