"""Run existing independently owned data with native Python reload and Vite HMR."""

import contextlib
import json
import os
import plistlib
import signal
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from threading import Event
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from scripts.website.native_layout import prepare, private_write  # noqa: E402

from studio.deployment.images import source_closure  # noqa: E402
from studio.runtime.lifecycle.locking import service_lock  # noqa: E402


def environment(root):
    env = {
        key: value for key, value in os.environ.items() if not key.startswith(("FPL_", "COMPOSE_"))
    }
    env.update(PYTHONPATH=os.pathsep.join((str(root / "backend"), str(root))), PYTHONUNBUFFERED="1")
    return env


def check_ports(ports):
    for port in ports:
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(f"本机端口 {port} 被占用；请先正常停止原实例") from None


def stop_process(child, timeout=30):
    with contextlib.suppress(ProcessLookupError):
        os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)


def clear_stale_bridge(path):
    if not path.exists():
        return
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError("本机桥接路径已被非本次运行的文件占用")
    with socket.socket(socket.AF_UNIX) as probe:
        try:
            probe.connect(str(path))
        except ConnectionRefusedError:
            path.unlink()
        else:
            raise RuntimeError("本机 Creative 桥接仍在运行")


def wait_health(children, ports, *, timeout=90):
    opener = build_opener(ProxyHandler({}))
    pending = set(ports)
    deadline = time.monotonic() + timeout
    while pending and time.monotonic() < deadline:
        failed = [name for name, child in children.items() if child.poll() is not None]
        if failed:
            raise RuntimeError(
                "本机服务启动失败："
                + ", ".join(failed)
                + "；请查看 .runtime/native-development/logs"
            )
        for port in list(pending):
            try:
                with opener.open(f"http://127.0.0.1:{port}/health", timeout=0.5) as response:
                    if response.status == 200:
                        pending.remove(port)
            except OSError:
                pass
        time.sleep(0.1)
    if pending:
        raise RuntimeError("本机服务启动超时：" + ", ".join(map(str, sorted(pending))))


def host_workers(root):
    """Reuse worker registrations as inputs without loading their production jobs."""
    result = []
    for path in sorted(
        (Path.home() / "Library/LaunchAgents").glob("cn.futurepropslab.worker.*.plist")
    ):
        definition = plistlib.loads(path.read_bytes())
        if not Path(definition.get("WorkingDirectory", "/")).is_relative_to(root):
            continue
        label = definition["Label"]
        loaded = subprocess.run(
            ["launchctl", "print", f"gui/{os.getuid()}/{label}"], capture_output=True
        )
        if loaded.returncode == 0:
            raise RuntimeError("正式 Worker 仍在运行：" + label)
        result.append((label.rsplit(".", 1)[1], definition["ProgramArguments"][1:]))
    return result


def run(root=ROOT, *, public=False, public_management=False):
    if public_management and not public:
        raise ValueError("--public-management 需要同时指定 --public")
    directory = root / ".runtime/native-development"
    if directory.is_symlink():
        raise RuntimeError("本机运行目录不能是符号链接")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    caddy = directory / "tools/caddy"
    if not caddy.is_file():
        raise RuntimeError(
            "缺少本机 Caddy；请先按开发流程准备 .runtime/native-development/tools/caddy"
        )
    children = {}
    ownership = contextlib.ExitStack()
    acquired = False
    stop = Event()

    def shutdown(_sig, _frame):
        stop.set()

    previous = {sig: signal.signal(sig, shutdown) for sig in (signal.SIGINT, signal.SIGTERM)}
    env = environment(root)

    def spawn(name, command, additional=None):
        log_path = directory / "logs" / (name + ".log")
        log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        handle = os.fdopen(descriptor, "a")
        try:
            child = subprocess.Popen(
                command,
                cwd=root,
                env={**env, **(additional or {})},
                stdin=subprocess.DEVNULL,
                stdout=handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        finally:
            handle.close()
        children[name] = child
        return child

    try:
        try:
            ownership.enter_context(service_lock(directory))
        except RuntimeError:
            record = directory / "process.json"
            try:
                current = json.loads(record.read_text())
            except (OSError, ValueError):
                current = {}
            if (current.get("public", False), current.get("public_management", False)) != (
                public,
                public_management,
            ):
                raise RuntimeError(
                    "热加载已按其他公网参数启动；请先正常停止原实例，再使用新参数启动"
                ) from None
            print("本机热加载已启动：http://127.0.0.1:3000；无需重复启动", flush=True)
            return
        acquired = True
        ownership.enter_context(service_lock(root / ".runtime/deployment/native-mode"))
        clear_stale_bridge(directory / "bridge/creative.sock")
        workers = host_workers(root)
        tunnels = {}
        if public:
            from scripts.website.native_public import configured_tunnels

            tunnels = configured_tunnels(
                root, root / "backend/config.toml", management=public_management
            )
        services = prepare(
            root,
            root / "backend/config.toml",
            directory,
            caddy,
            public_profiles={name: tunnel.profile for name, tunnel in tunnels.items()},
        )
        from importlib import import_module

        from studio.deployment.images import STUDIO_OWNERS
        from studio.runtime.database.migrations import check

        owners = {service: owner for owner, service in STUDIO_OWNERS.items()}
        for service in services:
            registry = import_module(
                f"studio.apps.{owners[service.name]}.storage.migrations.registry"
            ).MIGRATIONS
            check(service.state / "service.db", service.name, registry)
        ports = [service.port for service in services]
        listeners = [3000, 9001, 9002, 29090, 29092, *ports]
        listeners.extend(tunnel.profile.local_port for tunnel in tunnels.values())
        if len(listeners) != len(set(listeners)):
            raise RuntimeError("公网监听端口与本机服务重复，请检查公网端口配置")
        check_ports(listeners)
        # Only validate; startup must never apply schema migrations.
        for name in ("gateway", "management"):
            subprocess.run(
                [
                    str(caddy),
                    "validate",
                    "--config",
                    str(directory / f"{name}.Caddyfile"),
                    "--adapter",
                    "caddyfile",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        for service in services:
            spawn(service.name, [sys.executable, *service.command], service.environment)
        wait_health(children, ports)
        spawn(
            "management-proxy",
            [
                str(caddy),
                "run",
                "--config",
                str(directory / "management.Caddyfile"),
                "--adapter",
                "caddyfile",
            ],
        )
        for name, arguments in workers:
            spawn("worker-" + name, [sys.executable, *arguments])
        spawn(
            "web",
            ["npm", "run", "dev", "--workspace", "web", "--", "--config", "native.config.ts"],
            {
                "FPL_NATIVE_WEB_CONFIG": str(directory / "web.json"),
                "FPL_VITE_CACHE_DIR": str(directory / "vite-cache"),
                "FPL_NATIVE_PUBLIC_ORIGINS": json.dumps(
                    sorted({tunnel.profile.origin for tunnel in tunnels.values()})
                ),
            },
        )
        if public:
            wait_health({"web": children["web"]}, [3000])
            spawn(
                "public-access",
                [
                    sys.executable,
                    "-m",
                    "scripts.website.native_public",
                    "--config",
                    str(root / "backend/config.toml"),
                    *(["--management"] if public_management else []),
                ],
            )
        private_write(
            directory / "process.json",
            json.dumps(
                {
                    "pid": os.getpid(),
                    "public": public,
                    "public_management": public_management,
                    "services": {name: child.pid for name, child in children.items()},
                }
            ),
        )
        print("本机独立服务已启动：http://127.0.0.1:3000（Python 重载 / Vite 热更新）", flush=True)
        if public:
            print(
                "公网隧道连接中；状态：.runtime/native-development/public-access.json；"
                "日志：.runtime/native-development/logs/public-access.log",
                flush=True,
            )
        dependencies = {
            service.name: set(source_closure(root, service.name).values()) for service in services
        }
        by_name = {service.name: service for service in services}
        failed_reloads = set()
        from watchfiles import PythonFilter, watch

        for changes in watch(
            root / "backend",
            root / "scripts/website",
            stop_event=stop,
            watch_filter=PythonFilter(),
            yield_on_timeout=True,
            rust_timeout=1000,
        ):
            if stop.is_set():
                break
            failed = [
                name
                for name, child in children.items()
                if child.poll() is not None and name not in failed_reloads
            ]
            if failed:
                raise RuntimeError("本机进程已退出：" + ", ".join(failed))
            changed = {Path(path) for _event, path in changes}
            restart = {name for name, paths in dependencies.items() if paths & changed}
            if any(path.is_relative_to(root / "scripts/website") for path in changed):
                raise RuntimeError("启动器源码已变化；请重新运行 npm run dev")
            for name in sorted(restart):
                print(f"重新加载 {name}", flush=True)
                stop_process(children[name])
                service = by_name[name]
                spawn(name, [sys.executable, *service.command], service.environment)
                try:
                    dependencies[name] = set(source_closure(root, name).values())
                except (SyntaxError, ValueError):
                    # Keep the previous dependency set so a syntax repair is observed.
                    stop_process(children[name])
                    failed_reloads.add(name)
            if restart:
                try:
                    wait_health(
                        {name: children[name] for name in restart},
                        [by_name[name].port for name in restart],
                    )
                    failed_reloads.difference_update(restart)
                except RuntimeError:
                    failed_reloads.update(restart)
                    print(
                        "代码重载失败；修正源码后自动重试。日志：.runtime/native-development/logs",
                        flush=True,
                    )
            if changed:
                for worker_name, arguments in workers:
                    name = "worker-" + worker_name
                    stop_process(children[name])
                    spawn(name, [sys.executable, *arguments])
                private_write(
                    directory / "process.json",
                    json.dumps(
                        {
                            "pid": os.getpid(),
                            "public": public,
                            "public_management": public_management,
                            "services": {name: child.pid for name, child in children.items()},
                        }
                    ),
                )
    finally:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        # Signal all groups before waiting, so shutdown has one bounded drain window.
        for child in reversed(list(children.values())):
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGTERM)
        deadline = time.monotonic() + 30
        for child in reversed(list(children.values())):
            with contextlib.suppress(subprocess.TimeoutExpired):
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        if acquired:
            (directory / "process.json").unlink(missing_ok=True)
        ownership.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    try:
        run()
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from None
