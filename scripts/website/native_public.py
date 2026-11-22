"""Own opt-in development tunnels using the existing public gateway policy."""

import argparse
import asyncio
import json
import signal
from pathlib import Path

from scripts.website.native_layout import private_write

from studio.config import read_config
from studio.contracts.gateway.web_access import GatewayProfile
from studio.host.deployment.management_tunnels import GatewayTunnel


def configured_tunnels(root, config, *, management=False):
    values = read_config(config)
    credentials = Path(
        values.get("fpl_management_host_credentials_root", "backend/web-access/credentials")
    ).expanduser()
    if not credentials.is_absolute():
        credentials = root / credentials
    if credentials.is_symlink():
        raise ValueError("SSH 凭据目录不能是符号链接")
    result = {}
    gateways = [("gateway", "fpl_remote_web_", 28081, 28080)]
    if management:
        gateways.append(("management", "fpl_management_remote_", 28083, 28082))
    for service, prefix, port, remote in gateways:
        profile = GatewayProfile(
            origin=values.get(
                "fpl_management_public_origin" if service == "management" else prefix + "origin",
                "",
            ),
            local_port=values.get(prefix + "port", port),
            host=values.get(prefix + "ssh_host", ""),
            user=values.get(prefix + "ssh_user", ""),
            ssh_port=values.get(prefix + "ssh_port", 22),
            remote_port=values.get(prefix + "remote_port", remote),
            identity_id=values.get(prefix + "identity_id", ""),
            known_hosts_id=values.get(prefix + "known_hosts_id", ""),
        )
        if not profile.origin or not profile.host or not profile.user:
            raise ValueError(f"{service} 公网配置不完整，请检查 backend/config.toml")
        tunnel = GatewayTunnel(profile, credentials, service=service)
        tunnel.credential(profile.identity_id, "identity")
        tunnel.credential(profile.known_hosts_id, "known_hosts")
        result[service] = tunnel
    profiles = [tunnel.profile for tunnel in result.values()]
    if len({p.local_port for p in profiles}) != len(profiles) or len(
        {(p.host, p.ssh_port, p.remote_port) for p in profiles}
    ) != len(profiles):
        raise ValueError("Studio 和管理端必须使用独立的公网转发端口")
    return result


async def serve(tunnels, status_path, stop):
    previous = None
    try:
        for tunnel in tunnels.values():
            await tunnel.action("public_start")
        while not stop.is_set():
            status = {name: tunnel.snapshot() for name, tunnel in tunnels.items()}
            if status != previous:
                private_write(status_path, json.dumps(status, ensure_ascii=False))
                for name, state in status.items():
                    print(
                        f"{name} 公网：{state['phase']} {state['url']} {state['error']}",
                        flush=True,
                    )
                previous = status
            if any(tunnel.phase == "failed" for tunnel in tunnels.values()):
                raise RuntimeError("公网 SSH 授权失败，请检查公网日志与已导入凭据")
            for tunnel in tunnels.values():
                if tunnel.task is not None and tunnel.task.done():
                    await tunnel.task
                    raise RuntimeError("公网隧道监督任务已退出，请检查公网日志")
            try:
                await asyncio.wait_for(stop.wait(), 0.5)
            except TimeoutError:
                pass
    finally:
        await asyncio.gather(*(tunnel.close() for tunnel in tunnels.values()))
        private_write(
            status_path,
            json.dumps({name: tunnel.snapshot() for name, tunnel in tunnels.items()}),
        )


async def run(config, *, management=False):
    root = config.resolve().parent.parent
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await serve(
            configured_tunnels(root, config, management=management),
            root / ".runtime/native-development/public-access.json",
            stop,
        )
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(sig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FPL development public tunnels")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--management", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.config, management=args.management))
