"""Trusted-local provisioning for the cloud workspace."""

import asyncio
import os
from contextlib import nullcontext
from pathlib import Path

import tomlkit
from fastapi import HTTPException

from app.console.governance.deployment_config import config_bytes, replace_config, revision
from app.runtime.config import REPO_ROOT, get_cloud_settings
from app.runtime.ids import new_id
from fpl_config import CONFIG_FILE

from .access import enrolled
from .project_paths import validate_project_root
from .schemas import CloudSetup, SetupProject


def assert_setup_account(settings, principal):
    ids = set(filter(None, settings.fpl_cloud_control_admin_user_ids.split(os.pathsep)))
    if ids and principal.user_id not in ids:
        raise HTTPException(403, "该账号未获准管理云控配置")


def project_candidates(settings, owner):
    known = {
        project.root: project.label
        for project in settings.fpl_cloud_control_projects.values()
        if owner in project.user_ids
    }
    candidates = {**known, str(REPO_ROOT): known.get(str(REPO_ROOT), REPO_ROOT.name)}
    with (
        os.scandir(Path.home() / "Projects")
        if (Path.home() / "Projects").is_dir()
        else nullcontext(()) as entries
    ):
        for entry in entries:
            if len(candidates) >= 80:
                break
            if entry.is_dir(follow_symlinks=False):
                candidates.setdefault(entry.path, entry.name[:80])
    output = []
    for root, label in sorted(candidates.items(), key=lambda pair: pair[1].casefold()):
        if root not in known:
            try:
                validate_project_root(root, settings)
            except HTTPException:
                continue
        output.append(SetupProject(label=label, root=root, selected=root in known))
    return output


async def probe_port(port, *, vnc=False):
    try:
        async with asyncio.timeout(1):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            try:
                return not vnc or (await reader.readexactly(4)) == b"RFB "
            finally:
                writer.close()
    except (OSError, TimeoutError, EOFError):
        return False


async def read_setup(db, principal):
    raw = config_bytes(CONFIG_FILE)
    settings = get_cloud_settings()
    assert_setup_account(settings, principal)
    has_factor = await enrolled(db, principal.user_id)
    await db.rollback()
    guacd, sharing = await asyncio.gather(
        probe_port(settings.fpl_cloud_control_guacd_port),
        probe_port(settings.fpl_cloud_control_vnc_port, vnc=True),
    )
    if config_bytes(CONFIG_FILE) != raw:
        raise HTTPException(409, "配置已变更，请刷新后重试")
    return CloudSetup(
        revision=revision(raw),
        host_label=settings.fpl_cloud_control_host_label,
        enabled=settings.fpl_cloud_control_enabled,
        public_enabled=settings.fpl_cloud_control_public_enabled,
        public_desktop_vnc_only=settings.fpl_cloud_control_public_desktop_vnc_only,
        enrolled=has_factor,
        guacd_ready=guacd,
        screen_sharing_ready=(
            sharing
            if settings.fpl_cloud_control_vnc_host in {"127.0.0.1", "host.docker.internal"}
            else None
        ),
        projects=project_candidates(settings, principal.user_id),
    )


async def save_setup(db, principal, body):
    settings = get_cloud_settings()
    assert_setup_account(settings, principal)
    owner = principal.user_id
    if (
        body.public_enabled
        and not settings.fpl_cloud_control_public_desktop_vnc_only
        and not await enrolled(db, owner)
    ):
        raise HTTPException(409, "请先在本机登记验证器")
    await db.rollback()
    roots = {str(validate_project_root(root, settings)) for root in body.projects}
    label = body.host_label.strip()
    if not label:
        raise HTTPException(422, "请填写主机名称")

    def edit(document):
        cloud = document.setdefault("cloud_control", tomlkit.table())
        cloud["enabled"] = True
        cloud["public_enabled"] = body.public_enabled
        cloud["host_label"] = label
        cloud["admin_user_ids"] = list(dict.fromkeys([*cloud.get("admin_user_ids", []), owner]))
        cloud.pop("vnc_password", None)
        projects = cloud.setdefault("projects", tomlkit.table())
        for project in projects.values():
            users = [item for item in project["user_ids"] if item != owner]
            if project["root"] in roots:
                users.append(owner)
                roots.remove(project["root"])
            if list(project["user_ids"]) != users:
                project["user_ids"] = users
        for root in sorted(roots):
            projects[new_id()] = {"label": Path(root).name[:80], "root": root, "user_ids": [owner]}

    await asyncio.to_thread(replace_config, CONFIG_FILE, body.revision, edit)
    return await read_setup(db, principal)
