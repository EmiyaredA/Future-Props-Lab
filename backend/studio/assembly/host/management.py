"""Mac management entry; formal settings come only from backend/config.toml."""

import argparse
import asyncio
import os
import stat
from pathlib import Path

import httpx

from studio.config import read_config
from studio.contracts.gateway.web_access import GatewayProfile
from studio.host.deployment.management_control import DeploymentControl
from studio.host.deployment.management_tunnels import GatewayTunnel
from studio.host.deployment.management_worker import ManagementWorker
from studio.host.transport import NativeTransport
from studio.runtime.lifecycle.locking import service_lock


def configuration(path):
    values = read_config(path)
    root = path.resolve().parent.parent

    def location(value):
        p = Path(value).expanduser()
        return p if p.is_absolute() else root / p

    def profile(prefix, default_port, default_remote):
        def field(name, default=""):
            if name == "origin" and prefix == "fpl_management_remote_":
                return values.get("fpl_management_public_origin", default)
            return values.get(prefix + name, default)

        return GatewayProfile(
            origin=field("origin"),
            local_port=field("port", default_port),
            host=field("ssh_host"),
            user=field("ssh_user"),
            ssh_port=field("ssh_port", 22),
            remote_port=field("remote_port", default_remote),
            identity_id=field("identity_id"),
            known_hosts_id=field("known_hosts_id"),
        )

    credential = location(values["fpl_management_host_credential_file"])
    if (
        credential.is_symlink()
        or credential.stat().st_uid != os.getuid()
        or stat.S_IMODE(credential.stat().st_mode) & 0o077
    ):
        raise ValueError("管理 worker 凭据必须归当前用户所有且权限不超过 0600")
    credentials = location(
        values.get("fpl_management_host_credentials_root", "backend/web-access/credentials")
    )
    if credentials.is_symlink():
        raise ValueError("SSH 凭据目录不能是符号链接")
    control = DeploymentControl(
        compose_file=location(values["fpl_deployment_compose_file"]),
        project_name=values["fpl_deployment_project_name"],
        services=values["fpl_management_host_business_services"].split(os.pathsep),
        environment=values.get("fpl_deployment_environment", {}),
        tunnels={
            "business": GatewayTunnel(
                profile("fpl_remote_web_", 28081, 28080), credentials, service="gateway"
            ),
            "management": GatewayTunnel(
                profile("fpl_management_remote_", 28083, 28082), credentials, service="management"
            ),
        },
    )
    transport = NativeTransport(
        base_url=values["fpl_management_host_base_url"],
        credential=credential.read_text().strip(),
        service="management",
    )
    return (
        values,
        control,
        transport,
        location(values.get("fpl_management_host_state_root", ".runtime/management-host")),
    )


async def run_worker(values, control, transport, state):
    async def configured():
        return None

    if values.get("fpl_management_host_auto_start", True):
        try:
            await control.execute("management.application", {"action": "start"}, configured)
        except RuntimeError:
            control.phase, control.error = "failed", "业务服务启动失败；管理端继续运行"
    for target, enabled in (
        ("business", values.get("fpl_website_public_enabled", False)),
        ("management", values.get("fpl_management_remote_enabled", False)),
    ):
        if enabled:
            try:
                await control.tunnels[target].action("public_start")
            except (ValueError, httpx.HTTPError, OSError):
                control.tunnels[target].phase, control.tunnels[target].error = (
                    "failed",
                    "公网启动失败，请本机检查配置与构建",
                )
    await ManagementWorker(transport, control, state).run()


def run():
    parser = argparse.ArgumentParser(description="FPL Mac management worker")
    parser.add_argument("--config", type=Path, default=Path("backend/config.toml"))
    options = parser.parse_args()
    values, control, transport, state = configuration(options.config)
    with service_lock(state):
        asyncio.run(run_worker(values, control, transport, state))


if __name__ == "__main__":
    run()
