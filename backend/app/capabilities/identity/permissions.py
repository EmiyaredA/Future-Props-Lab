"""Fixed account capabilities; resource ownership is checked independently."""

CLOUD_CONTROL_PERMISSION = "cloud-control.access"


def requires_cloud_control(path: str) -> bool:
    roots = ("/v1/agent-workbench", "/v1/cloud-control")
    return path in roots or any(path.startswith(root + "/") for root in roots)


READ_PERMISSIONS = frozenset({"content.read", "logs.read", "audit.read", "docs.developer"})
USER_PERMISSIONS = READ_PERMISSIONS | {
    "content.write",
    "models.use",
    "configuration.manage",
    "diagnostics.model",
    "diagnostics.realtime",
    "tools.sensitive",
}
ADMIN_PERMISSIONS = USER_PERMISSIONS | {"projects.certify", CLOUD_CONTROL_PERMISSION}


def role_permissions(role: str) -> frozenset[str]:
    return {"admin": ADMIN_PERMISSIONS, "user": USER_PERMISSIONS}.get(role, frozenset())


def effective_permissions(role: str, scopes: frozenset[str]) -> frozenset[str]:
    if "studio:private_read" not in scopes:
        return frozenset()
    permissions = role_permissions(role)
    if "studio:write" not in scopes:
        permissions &= READ_PERMISSIONS
    return frozenset(permissions)


def role_scopes(role: str) -> frozenset[str]:
    if not role_permissions(role):
        return frozenset()
    return frozenset({"studio:read", "studio:private_read", "studio:write"})
