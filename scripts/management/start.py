"""One-command management launch; configuration is TOML and no schema migration is implicit."""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from fpl_config import read_config  # noqa: E402
from fpl_runtime.locking import service_lock  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "backend/config.toml")
    parser.add_argument("--only-management", action="store_true")
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    values = read_config(options.config)
    environment = values.get("fpl_deployment_environment", {})
    if not environment or "FPL_MANAGEMENT_IMAGE" not in environment:
        raise SystemExit("独立服务尚未配置，请先完成隔离构建与部署配置；不会迁移或接管旧数据库")
    compose = Path(values["fpl_deployment_compose_file"])
    if not compose.is_absolute():
        compose = ROOT / compose
    command = [
        "docker",
        "compose",
        "--file",
        str(compose),
        "--file",
        str(ROOT / "deploy/management.compose.yaml"),
        "--project-name",
        values["fpl_deployment_project_name"],
    ]
    import asyncio

    from fpl_host.management import configuration, run_worker
    from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
    from fpl_management.migrations.registry import MIGRATIONS as MANAGEMENT_MIGRATIONS
    from fpl_runtime.migrations import check

    configured, control, transport, state = configuration(options.config)
    env = control.env
    if options.only_management:
        configured["fpl_management_host_auto_start"] = False
        configured["fpl_website_public_enabled"] = False
    with service_lock(state):
        # Acquire the host singleton before any Compose action, including a second npm start.
        for identity, registry in (
            ("IDENTITY", IDENTITY_MIGRATIONS),
            ("MANAGEMENT", MANAGEMENT_MIGRATIONS),
        ):
            database = Path(environment["FPL_" + identity + "_STATE"])
            if not database.is_absolute():
                database = ROOT / database
            check(database / "service.db", identity.lower(), registry)
        subprocess.run([*command, "config", "--quiet"], env=env, check=True, cwd=ROOT)
        if options.check:
            asyncio.run(transport.close())
            print("Management deployment configuration and schemas are ready")
            return
        # Identity and Models stay outside the stoppable business group.
        subprocess.run(
            [*command, "up", "--detach", "identity", "management"],
            env=env,
            check=True,
            cwd=ROOT,
        )
        models = subprocess.run(
            [*command, "up", "--detach", "--no-deps", "models"],
            env=env,
            check=False,
            cwd=ROOT,
        )
        if models.returncode:
            print("Models 启动失败；管理端继续运行，模型治理暂不可用", file=sys.stderr)
        asyncio.run(run_worker(configured, control, transport, state))


if __name__ == "__main__":
    main()
