"""Availability combines real probe outcomes with bounded, fresh host evidence."""

from datetime import timedelta

import httpx
import pytest

from studio.apps.gateway.service_status import ServiceMonitor
from studio.contracts.gateway.service_status import DeploymentServicesOut, status_time
from studio.host.deployment.service_observation import ServiceObserver, container_state
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


class Host:
    def __init__(self, samples=(), *, age=0, unavailable=False, denied=False):
        self.value = DeploymentServicesOut(
            observed_at=status_time() - timedelta(seconds=age), services=list(samples)
        )
        self.unavailable, self.denied = unavailable, denied

    async def deployment_status(self, **_values):
        if self.denied:
            raise CapabilityDenied(401)
        if self.unavailable:
            raise CapabilityUnavailable()
        return self.value


def monitor(host, failures=None):
    failures = failures or {}
    calls = []

    def handle(request):
        name = request.url.host
        calls.append((name, request.url.path))
        kind = failures.get(name)
        if kind == "offline":
            raise httpx.ConnectError("synthetic unavailable", request=request)
        if kind == "redirect":
            return httpx.Response(302, headers={"Location": "https://unexpected.invalid"})
        if kind == "wrong":
            return httpx.Response(200, json={"status": "ready", "service": "someone-else"})
        if kind == "not_ready" and request.url.path == "/ready":
            return httpx.Response(503)
        return httpx.Response(
            200, json={"status": "ready" if request.url.path == "/ready" else "ok", "service": name}
        )

    return ServiceMonitor(host, transport=httpx.MockTransport(handle)), calls


@pytest.mark.parametrize("kind", ["wrong", "redirect"])
async def test_wrong_service_or_redirect_fails_closed(kind):
    service, calls = monitor(Host(), {"remote": kind})
    try:
        result = await service.snapshot(assertion="original-gateway-request")
        item = next(s for s in result.services if s.service_id == "remote")
        assert item.phase == "failed" and "身份不匹配" in item.detail
        assert not any(name == "unexpected.invalid" for name, _path in calls)
    finally:
        await service.close()


@pytest.mark.parametrize("age,phase", [(0, "stopped"), (60, "unreachable"), (-60, "unreachable")])
async def test_only_fresh_lifecycle_evidence_can_report_stopped(age, phase):
    service, _ = monitor(
        Host([{"service_id": "remote", "phase": "stopped", "reason": "process_stopped"}], age=age),
        {"remote": "offline"},
    )
    try:
        result = await service.snapshot(assertion="request")
        assert next(s for s in result.services if s.service_id == "remote").phase == phase
    finally:
        await service.close()


async def test_live_readiness_wins_over_earlier_stop_and_probe_results_are_cached():
    service, calls = monitor(
        Host([{"service_id": "remote", "phase": "stopped", "reason": "process_stopped"}])
    )
    try:
        result = await service.snapshot(assertion="request")
        assert all(s.phase == "running" for s in result.services)
        count = len(calls)
        await service.snapshot(assertion="request-two")
        assert len(calls) == count
    finally:
        await service.close()


async def test_newer_host_stop_supersedes_cached_success_without_restarting_other_services():
    host = Host()
    service, calls = monitor(host)
    try:
        first = await service.snapshot(assertion="request")
        assert next(s for s in first.services if s.service_id == "remote").phase == "running"
        count = len(calls)
        host.value = DeploymentServicesOut(
            observed_at=status_time(),
            services=[{"service_id": "remote", "phase": "stopped", "reason": "process_stopped"}],
        )
        result = {s.service_id: s for s in (await service.snapshot(assertion="request")).services}
        assert result["remote"].phase == "stopped"
        assert result["identity"].phase == "running"
        assert result["remote"].checked_at == host.value.observed_at
        assert len(calls) == count
    finally:
        await service.close()


async def test_dependencies_propagate_even_when_catalog_order_is_not_topological():
    service, _ = monitor(Host(), {"assets": "offline"})
    try:
        result = {s.service_id: s for s in (await service.snapshot(assertion="request")).services}
        assert result["assets"].phase == "unreachable"
        assert result["models"].phase == "degraded"
        assert result["management"].phase == "degraded"
    finally:
        await service.close()


async def test_dependency_outage_is_distinct_from_app_process_failure():
    service, _ = monitor(
        Host([{"service_id": "models", "phase": "stopped", "reason": "process_stopped"}]),
        {"models": "offline", "thought": "not_ready"},
    )
    try:
        result = {s.service_id: s for s in (await service.snapshot(assertion="request")).services}
        assert result["visual"].phase == "degraded"
        assert result["visual"].dependencies[0].service_id == "models"
        assert result["thought"].phase == "unhealthy"
    finally:
        await service.close()


async def test_creative_status_includes_project_certification_dependencies():
    service, _ = monitor(Host(), {"galgame": "not_ready"})
    try:
        result = {s.service_id: s for s in (await service.snapshot(assertion="request")).services}
        assert result["creative"].phase == "degraded"
        assert [item.service_id for item in result["creative"].dependencies] == ["galgame"]
    finally:
        await service.close()


async def test_monitor_outage_is_unknown_and_revocation_is_not_swallowed():
    service, _ = monitor(Host(unavailable=True), {"remote": "offline"})
    try:
        item = next(
            s
            for s in (await service.snapshot(assertion="request")).services
            if s.service_id == "remote"
        )
        assert item.phase == "unreachable" and "不能确认是否已停止" in item.detail
        service.capabilities.denied = True
        with pytest.raises(CapabilityDenied):
            await service.snapshot(assertion="revoked")
    finally:
        await service.close()


@pytest.mark.parametrize(
    "row,phase,reason",
    [
        ({"State": "running", "Health": "healthy"}, "running", "healthy"),
        ({"State": "running", "Health": "starting"}, "starting", "health_starting"),
        ({"State": "running", "Health": "unhealthy"}, "unhealthy", "health_failed"),
        ({"State": "restarting"}, "restarting", "process_restarting"),
        ({"State": "paused"}, "paused", "process_paused"),
        ({"State": "dead"}, "failed", "process_dead"),
        ({"State": "exited", "ExitCode": 1}, "failed", "process_exited"),
        ({"State": "exited", "ExitCode": 0}, "stopped", "process_stopped"),
        ({"State": "exited", "ExitCode": 143}, "stopped", "process_stopped"),
        ({"State": "exited", "ExitCode": 137}, "stopped", "process_terminated"),
    ],
)
def test_real_container_lifecycle_has_explicit_explanation(row, phase, reason):
    value = container_state("remote", row)
    assert value.phase == phase and value.reason == reason


def test_observer_distinguishes_not_configured_not_started_and_unreadable_docker():
    calls = []

    def run(args):
        calls.append(args)
        return (
            "gateway\nremote\n"
            if args[0] == "config"
            else '[{"Service":"gateway","State":"running","Private":"never expose"}]'
        )

    values = ServiceObserver(run).read()
    statuses = {s["service_id"]: s for s in values}
    assert statuses["remote"]["phase"] == "stopped"
    assert statuses["visual"]["phase"] == "not_deployed"
    assert "Private" not in str(values) and "never expose" not in str(values)
    assert calls == [["config", "--services"], ["ps", "--all", "--format", "json"]]

    def unavailable(_args):
        raise RuntimeError("private runtime detail")

    assert all(s["phase"] == "unknown" for s in ServiceObserver(unavailable).read())


def test_running_orphan_container_is_not_reported_as_never_deployed():
    def run(args):
        return "gateway\n" if args[0] == "config" else '[{"Service":"remote","State":"running"}]'

    values = {s["service_id"]: s for s in ServiceObserver(run).read()}
    assert values["remote"]["phase"] == "running"
