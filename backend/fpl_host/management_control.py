"""Mac-only fixed Compose control. Containers receive no Docker socket or host directories."""

import asyncio
import json
import os
import re
import subprocess
import time
from pathlib import Path

from fpl_runtime.catalog import BY_ID

from .service_observation import ServiceObserver

PROTECTED = frozenset({"identity", "management", "models"})


def redact(line):
    line = re.sub(r"(?i)(bearer\s+)[^\s\"']+", r"\1[redacted]", line)
    line = re.sub(r"\b(?:fpm_|sk-)[A-Za-z0-9_-]+", "[redacted]", line)
    line = re.sub(
        r"(?i)([\"']?(?:password|secret|token|api[_-]?key|cookie|authorization)[\"']?\s*[=:]\s*)[\"']?[^\r\n,;]+",
        r"\1[redacted]",
        line,
    )
    return re.sub(r"(https?://)[^/@\s:]+:[^/@\s]+@", r"\1[redacted]@", line)[:2000]


class DeploymentControl:
    def __init__(
        self,
        *,
        compose_file,
        project_name,
        services,
        environment,
        tunnels,
        runner=subprocess.run,
        clock=time.monotonic,
    ):
        selected = Path(compose_file)
        self.compose_file = selected.resolve()
        if not self.compose_file.is_file() or selected.is_symlink():
            raise ValueError("部署 Compose 文件不可用")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,60}", project_name):
            raise ValueError("部署项目名称无效")
        if not services or set(services) - (BY_ID.keys() - PROTECTED):
            raise ValueError("业务服务清单无效或包含必须保持运行的治理服务")
        if not isinstance(environment, dict) or any(
            not re.fullmatch(r"FPL_[A-Z0-9_]+", key) or not isinstance(value, str)
            for key, value in environment.items()
        ):
            raise ValueError("Compose 环境配置无效")
        self.prefix = [
            "docker",
            "compose",
            "--env-file",
            "/dev/null",
            "--file",
            str(self.compose_file),
        ]
        overlay = self.compose_file.parent / "management.compose.yaml"
        if overlay.is_file():
            self.prefix.extend(["--file", str(overlay)])
        if environment.get("FPL_MODELS_IMAGE"):
            model_overlay = self.compose_file.parent / "models.compose.yaml"
            if not model_overlay.is_file() or model_overlay.is_symlink():
                raise ValueError("已选择 Models 镜像但缺少匹配的服务部署清单")
            self.prefix.extend(["--file", str(model_overlay)])
        if environment.get("FPL_INTEGRATIONS_IMAGE"):
            integration_overlay = self.compose_file.parent / "integrations.compose.yaml"
            if not integration_overlay.is_file() or integration_overlay.is_symlink():
                raise ValueError("已选择 Integrations 镜像但缺少匹配的服务部署清单")
            self.prefix.extend(["--file", str(integration_overlay)])
        if environment.get("FPL_THOUGHT_IMAGE"):
            thought_overlay = self.compose_file.parent / "thought.compose.yaml"
            if not thought_overlay.is_file() or thought_overlay.is_symlink():
                raise ValueError("已选择 Thought 镜像但缺少匹配的服务部署清单")
            self.prefix.extend(["--file", str(thought_overlay)])
        self.prefix.extend(["--project-name", project_name])
        self.services, self.env = tuple(services), {**os.environ, **environment}
        self.env["COMPOSE_DISABLE_ENV_FILE"] = "true"
        self.tunnels, self.runner = tunnels, runner
        self.clock = clock
        self.phase, self.error, self.force = "unavailable", "", False
        self.expected_running = None
        self.lock = asyncio.Lock()
        self.service_observer = ServiceObserver(self.run, clock=self.clock)

    def run(self, arguments, timeout=15):
        try:
            result = self.runner(
                [*self.prefix, *arguments],
                env=self.env,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise RuntimeError("部署工具暂不可用或命令超时") from None
        if result.returncode:
            raise RuntimeError("部署操作失败，请在本机核查已创建的服务和配置")
        return result.stdout

    def states(self):
        raw = self.run(["ps", "--all", "--format", "json", *self.services])
        try:
            rows = json.loads(raw or "[]")
            if isinstance(rows, dict):
                rows = [rows]
        except json.JSONDecodeError:
            rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        return {
            row["Service"]: (
                "unhealthy" if row.get("Health") == "unhealthy" else row.get("State", "unknown")
            )
            for row in rows
            if row.get("Service") in self.services
        }

    async def snapshot(self):
        try:
            states = await asyncio.to_thread(self.states)
            running = len(states) == len(self.services) and all(
                value == "running" for value in states.values()
            )
            stopped = all(value in {"exited", "created", "dead"} for value in states.values())
            if self.expected_running is None and any(
                value in {"running", "restarting", "unhealthy"} for value in states.values()
            ):
                self.expected_running = True
            if self.phase not in {"starting", "stopping"} and not self.force:
                if running:
                    self.phase, self.error = "running", ""
                    self.expected_running = True
                elif stopped and self.expected_running is not True:
                    self.phase, self.error = "stopped", ""
                else:
                    missing = [name for name in self.services if states.get(name) != "running"]
                    self.phase = "failed"
                    self.error = "以下服务未就绪：" + ", ".join(missing) + "；其他服务继续运行"
        except (RuntimeError, ValueError, KeyError):
            self.phase, self.error = "unavailable", "本机部署状态暂不可读"
        return {
            "services": await asyncio.to_thread(self.service_observer.read),
            "application": {
                "phase": self.phase,
                "error": self.error,
                "force_stop_available": self.force,
            },
            **{key: tunnel.snapshot() for key, tunnel in self.tunnels.items()},
        }

    async def supervise(self):
        # Observation never changes another application's lifecycle. Only explicit,
        # authorized stop/restart commands may stop the selected business group.
        return await self.snapshot()

    async def stop(self):
        self.phase = "stopping"
        states = await asyncio.to_thread(self.states)
        active = [
            name
            for name in self.services
            if states.get(name) in {"running", "restarting", "unhealthy"}
        ]
        if active:
            await asyncio.to_thread(self.run, ["kill", "--signal", "SIGTERM", *active])
            deadline = self.clock() + 30
            while self.clock() < deadline:
                if all(
                    state not in {"running", "restarting", "unhealthy"}
                    for state in (await asyncio.to_thread(self.states)).values()
                ):
                    break
                await asyncio.sleep(0.25)
            else:
                self.phase, self.force = "failed", True
                self.error = "服务未在 30 秒内退出；可显式强制停止"
                raise RuntimeError(self.error)
        self.phase, self.force, self.expected_running = "stopped", False, False

    async def execute(self, operation, payload, authorize):
        async with self.lock:
            await authorize()
            if operation == "management.application":
                if set(payload) != {"action"} or payload["action"] not in {
                    "start",
                    "stop",
                    "restart",
                    "force_stop",
                }:
                    raise ValueError("无效应用动作")
                action = payload["action"]
                if self.force and action != "force_stop":
                    raise ValueError("请先确认并强制停止未退出的业务服务")
                if action in {"stop", "restart"}:
                    await self.stop()
                if action == "force_stop":
                    await asyncio.to_thread(
                        self.run, ["kill", "--signal", "SIGKILL", *self.services]
                    )
                    self.phase, self.force, self.expected_running = "stopped", False, False
                if action in {"start", "restart"}:
                    await authorize()
                    self.phase, self.expected_running = "starting", True
                    try:
                        await asyncio.to_thread(
                            self.run,
                            [
                                "up",
                                "--detach",
                                "--no-deps",
                                "--wait",
                                "--wait-timeout",
                                "30",
                                *self.services,
                            ],
                            40,
                        )
                    except RuntimeError:
                        self.phase, self.error = "failed", "业务服务启动失败，请检查部署状态与日志"
                        raise
                    self.phase = "running"
                self.error = ""
                return (await self.snapshot())["application"]
            if operation == "management.access":
                if set(payload) != {"target", "action"} or payload["target"] not in self.tunnels:
                    raise ValueError("无效公网目标")
                return await self.tunnels[payload["target"]].action(payload["action"])
            if operation == "management.logs":
                if payload:
                    raise ValueError("日志读取不接受文件路径")
                output = await asyncio.to_thread(
                    self.run, ["logs", "--no-color", "--tail", "80", *self.services]
                )
                return {"lines": [redact(line) for line in output[-65536:].splitlines()[-200:]]}
            raise ValueError("未登记的管理命令")
