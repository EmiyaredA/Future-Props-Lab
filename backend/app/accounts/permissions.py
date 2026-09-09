"""Fixed roles shared by HTTP, realtime and workspace projections."""

READ_PERMISSIONS = frozenset({"content.read"})
MEMBER_PERMISSIONS = READ_PERMISSIONS | {"content.write", "models.use"}
ADMIN_PERMISSIONS = MEMBER_PERMISSIONS | {
    "configuration.manage",
    "logs.read",
    "workspace.manage",
    "members.manage",
    "audit.read",
}
OWNER_PERMISSIONS = ADMIN_PERMISSIONS | {"members.assign_admin"}


def role_permissions(access: str, role: str | None) -> frozenset[str]:
    if access in {"owner", "platform_admin"}:
        return OWNER_PERMISSIONS
    if access == "public_viewer":
        return frozenset()
    return {
        "admin": ADMIN_PERMISSIONS,
        "member": MEMBER_PERMISSIONS,
        "viewer": READ_PERMISSIONS,
    }.get(role, frozenset())


def effective_permissions(access: str, role: str | None, scopes: frozenset[str]) -> frozenset[str]:
    permissions = role_permissions(access, role)
    if "studio:private_read" not in scopes:
        return frozenset()
    if "studio:write" not in scopes:
        permissions = permissions & {"content.read", "logs.read", "audit.read"}
    return frozenset(permissions)


def role_scopes(access: str, role: str | None) -> frozenset[str]:
    scopes = {"studio:read"}
    permissions = role_permissions(access, role)
    if "content.read" in permissions:
        scopes.add("studio:private_read")
    if "content.write" in permissions:
        scopes.add("studio:write")
    return frozenset(scopes)
