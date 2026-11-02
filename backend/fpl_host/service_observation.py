"""Read only the selected Compose project's lifecycle; never inspect databases or secrets."""

import json
import time

from fpl_runtime.catalog import SERVICES
from fpl_runtime.service_status import DeploymentServiceState, ServicePhase


def container_state(service_id, row):
    state, health = row.get("State"), row.get("Health")
    exit_code = row.get("ExitCode")
    if type(exit_code) is not int or not 0 <= exit_code <= 255:
        exit_code = None
    if state == "running":
        phase, reason = (
            (ServicePhase.STARTING, "health_starting")
            if health == "starting"
            else (ServicePhase.UNHEALTHY, "health_failed")
            if health == "unhealthy"
            else (ServicePhase.RUNNING, "healthy")
        )
    elif state == "restarting":
        phase, reason = ServicePhase.RESTARTING, "process_restarting"
    elif state == "paused":
        phase, reason = ServicePhase.PAUSED, "process_paused"
    elif state == "dead":
        phase, reason = ServicePhase.FAILED, "process_dead"
    elif state in {"exited", "dead"} and exit_code not in {None, 0, 137, 143}:
        phase, reason = ServicePhase.FAILED, "process_exited"
    elif state in {"exited", "dead", "created", "removing"}:
        phase = ServicePhase.STOPPED
        reason = "process_terminated" if exit_code == 137 else "process_stopped"
    else:
        phase, reason = ServicePhase.UNKNOWN, "unknown_process_state"
    return DeploymentServiceState(
        service_id=service_id, phase=phase, reason=reason, exit_code=exit_code
    )


class ServiceObserver:
    def __init__(self, run, *, clock=time.monotonic):
        self.run, self.clock = run, clock
        self.configured, self.expires = set(), 0

    def read(self):
        try:
            if self.clock() >= self.expires:
                configured = set(self.run(["config", "--services"]).split())
                self.configured, self.expires = configured, self.clock() + 10
            raw = self.run(["ps", "--all", "--format", "json"])
            try:
                rows = json.loads(raw or "[]")
                rows = [rows] if isinstance(rows, dict) else rows
            except json.JSONDecodeError:
                rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
            if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
                raise ValueError("Invalid Compose status")
            by_id = {row.get("Service"): row for row in rows}
            result = []
            for service in SERVICES:
                if service.id in by_id:
                    result.append(container_state(service.id, by_id[service.id]))
                elif service.id not in self.configured:
                    result.append(
                        DeploymentServiceState(
                            service_id=service.id, phase="not_deployed", reason="not_deployed"
                        )
                    )
                elif service.id not in by_id:
                    result.append(
                        DeploymentServiceState(
                            service_id=service.id, phase="stopped", reason="not_created"
                        )
                    )
            return [r.model_dump(mode="json") for r in result]
        except (OSError, RuntimeError, ValueError, KeyError, TypeError):
            return [
                DeploymentServiceState(
                    service_id=s.id, phase="unknown", reason="monitor_unavailable"
                ).model_dump(mode="json")
                for s in SERVICES
            ]
