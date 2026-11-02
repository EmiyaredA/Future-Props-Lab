"""Combine fresh readiness with sanitized host lifecycle, without mounting host data."""

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime

import httpx

from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.catalog import BY_ID, SERVICES
from fpl_runtime.service_status import (
    ServiceIssue,
    ServicesStatusOut,
    ServiceStatusOut,
    status_time,
)
from fpl_runtime.service_status import (
    ServicePhase as Phase,
)

HOST_DETAILS = {
    "health_starting": "进程正在启动，等待健康检查通过",
    "health_failed": "容器健康检查未通过",
    "process_exited": "进程异常退出",
    "process_dead": "容器异常终止或无法清理，请管理员检查运行环境",
    "process_restarting": "进程正在反复重启，请检查启动配置或资源限制",
    "process_paused": "服务进程已暂停",
    "process_terminated": "进程已终止，可能被强制停止或遇到资源不足",
    "process_stopped": "服务已停止",
    "not_created": "服务已配置，尚未启动",
    "not_deployed": "此服务尚未部署",
    "monitor_unavailable": "Mac 运行状态监控暂不可读",
}


@dataclass(frozen=True)
class ProbeResult:
    state: str
    checked_at: datetime = field(default_factory=status_time)


class ServiceMonitor:
    def __init__(self, capabilities, *, transport=None, clock=time.monotonic):
        self.capabilities, self.clock = capabilities, clock
        self.client = httpx.AsyncClient(
            trust_env=False, follow_redirects=False, timeout=1.5, transport=transport
        )
        self.capacity, self.lock = asyncio.Semaphore(8), asyncio.Lock()
        self.probes, self.expires = {}, 0
        self.checked_at = status_time()

    async def close(self):
        await self.client.aclose()

    async def probe(self, service):
        if service.id == "gateway":
            return ProbeResult("ready")
        async with self.capacity:
            try:
                response = await self.client.get(f"http://{service.id}:8080/ready")
                if response.status_code == 200:
                    try:
                        body = response.json()
                    except ValueError:
                        return ProbeResult("wrong_service")
                    if not isinstance(body, dict):
                        return ProbeResult("wrong_service")
                    return ProbeResult(
                        "ready"
                        if body.get("service") == service.id and body.get("status") == "ready"
                        else "wrong_service"
                    )
                if response.status_code in {301, 302, 303, 307, 308}:
                    return ProbeResult("wrong_service")
                live = await self.client.get(f"http://{service.id}:8080/health")
                if live.status_code == 200 and live.json().get("service") == service.id:
                    return ProbeResult("not_ready")
                return ProbeResult("unreachable")
            except (httpx.HTTPError, ValueError, AttributeError):
                return ProbeResult("unreachable")

    async def readiness(self):
        if self.clock() >= self.expires:
            async with self.lock:
                if self.clock() >= self.expires:
                    results = await asyncio.gather(*(self.probe(s) for s in SERVICES))
                    self.probes = dict(zip((s.id for s in SERVICES), results, strict=True))
                    self.checked_at = max(item.checked_at for item in results)
                    self.expires = self.clock() + 5
        return self.probes

    async def snapshot(self, *, assertion):
        readiness = asyncio.create_task(self.readiness())
        try:
            try:
                host = await self.capabilities.deployment_status(assertion=assertion)
            except CapabilityUnavailable:
                host = None
            probes = await readiness
            now = status_time()
            samples = {}
            if host and host.observed_at and 0 <= (now - host.observed_at).total_seconds() <= 20:
                samples = {s.service_id: s for s in host.services}
        finally:
            if not readiness.done():
                readiness.cancel()
            await asyncio.gather(readiness, return_exceptions=True)
        result = {}
        for service in SERVICES:
            evidence, sample = probes[service.id], samples.get(service.id)
            probe, checked_at = evidence.state, evidence.checked_at
            lifecycle = sample and sample.phase in {
                Phase.STOPPED,
                Phase.PAUSED,
                Phase.STARTING,
                Phase.RESTARTING,
                Phase.FAILED,
                Phase.NOT_DEPLOYED,
                Phase.UNHEALTHY,
            }
            host_is_newer = bool(sample and host.observed_at > evidence.checked_at)
            if probe == "ready" and not (lifecycle and host_is_newer):
                phase, detail = Phase.RUNNING, "服务已就绪"
            elif probe == "wrong_service":
                phase, detail = Phase.FAILED, "服务响应与部署身份不匹配，请管理员核对版本与路由"
            elif (
                probe == "not_ready"
                and sample
                and sample.phase
                in {
                    Phase.STOPPED,
                    Phase.PAUSED,
                    Phase.FAILED,
                    Phase.NOT_DEPLOYED,
                }
                and not host_is_newer
            ):
                phase, detail = Phase.UNHEALTHY, "进程存在，但健康检查未通过"
            elif lifecycle:
                phase = sample.phase
                checked_at = host.observed_at
                detail = HOST_DETAILS.get(sample.reason, "服务暂未就绪")
                if sample.exit_code not in {None, 0}:
                    detail += f"（退出码 {sample.exit_code}）"
            elif probe == "not_ready" or (sample and sample.phase == Phase.UNHEALTHY):
                phase, detail = Phase.UNHEALTHY, "进程存在，但健康检查未通过"
            else:
                phase = Phase.UNREACHABLE
                detail = "无法连接服务；主机监控不可读，暂不能确认是否已停止"
                if sample and sample.phase == Phase.RUNNING:
                    detail = "进程仍在运行，但服务无响应"
            result[service.id] = ServiceStatusOut(
                service_id=service.id,
                label=service.label,
                phase=phase,
                detail=detail,
                checked_at=checked_at,
            )
        completed, visiting = set(), set()

        def dependencies(service_id):
            if service_id in completed:
                return
            if service_id in visiting:
                raise ValueError("服务依赖登记形成环")
            visiting.add(service_id)
            definition = BY_ID[service_id]
            for name in definition.dependencies:
                dependencies(name)
            value = result[service_id]
            if value.phase == Phase.RUNNING:
                issues = [
                    result[name]
                    for name in definition.dependencies
                    if result[name].phase != Phase.RUNNING
                ]
                if issues:
                    value.phase = Phase.DEGRADED
                    value.detail = "应用已运行，部分依赖服务尚未就绪"
                    value.dependencies = [
                        ServiceIssue(service_id=s.service_id, label=s.label, phase=s.phase)
                        for s in issues
                    ]
            completed.add(service_id)
            visiting.remove(service_id)

        for service in SERVICES:
            dependencies(service.id)
        return ServicesStatusOut(
            mode="independent",
            checked_at=max(s.checked_at for s in result.values()),
            services=list(result.values()),
        )
