"""Registered partitions of the compatibility website's original settings table."""

from types import MappingProxyType

KEY_OWNERS = MappingProxyType({"runtime_quotas": "models", "code_agents": "agent-runtime"})
PREFIX_OWNERS = MappingProxyType(
    {
        "role_template:": "models",
        "demo_service:": "models",
        "account_defaults:": "models",
    }
)


def setting_owner(key: str) -> str | None:
    if key in KEY_OWNERS:
        return KEY_OWNERS[key]
    return next(
        (
            owner
            for prefix, owner in PREFIX_OWNERS.items()
            if key.startswith(prefix) and key[len(prefix) :]
        ),
        None,
    )
