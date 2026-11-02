"""Read-only native contracts; format adapters are loaded only by native callers."""

from importlib import import_module
from types import MappingProxyType

_EXPORTS = MappingProxyType(
    {
        "AgentId": (".contracts", "AgentId"),
        "Entry": (".contracts", "Entry"),
        "ReadBatch": (".contracts", "ReadBatch"),
        "SessionInfo": (".contracts", "SessionInfo"),
        "candidates": (".catalog", "candidates"),
        "get_adapter": (".catalog", "get_adapter"),
    }
)
__all__ = list(_EXPORTS)


def __getattr__(name):
    try:
        module, attribute = _EXPORTS[name]
    except KeyError:
        raise AttributeError(name) from None
    return getattr(import_module(module, __name__), attribute)
