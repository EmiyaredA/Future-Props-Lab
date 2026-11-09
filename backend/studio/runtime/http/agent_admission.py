"""Fence new Agent writes during a host-managed backend cutover."""

from pathlib import Path
from uuid import uuid4

from starlette.responses import JSONResponse

AGENT_ADMISSION_MOUNT = Path("/run/fpl/agent-admission")
PAUSE = "paused"
INFLIGHT = "inflight"
UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def admission_status(root: Path = AGENT_ADMISSION_MOUNT):
    if not (root / INFLIGHT).is_dir():
        return "unconfigured"
    return "paused" if (root / PAUSE).exists() else "accepting"


def admission_report():
    state = admission_status()
    report = {"agent_admission": state}
    if state == "paused":
        try:
            report["agent_admission_id"] = (AGENT_ADMISSION_MOUNT / PAUSE).read_text().strip()
        except OSError:
            pass
    return report


class AgentAdmission:
    def __init__(self, app, *, prefixes, root=AGENT_ADMISSION_MOUNT):
        self.app, self.root, self.prefixes = app, Path(root), prefixes
        self.enabled = self.root.is_dir()

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] not in UNSAFE
            or not scope["path"].startswith(self.prefixes)
            or not self.enabled
        ):
            await self.app(scope, receive, send)
            return

        if (self.root / PAUSE).exists():
            await self.unavailable(scope, receive, send)
            return

        # Check after reservation. Once the host publishes PAUSE, an admitted
        # request must either have a visible marker or have already persisted.
        marker = self.root / INFLIGHT / uuid4().hex
        try:
            marker.touch(exist_ok=False)
        except OSError:
            await self.unavailable(scope, receive, send)
            return
        try:
            if (self.root / PAUSE).exists():
                await self.unavailable(scope, receive, send)
            else:
                await self.app(scope, receive, send)
        finally:
            marker.unlink(missing_ok=True)

    @staticmethod
    async def unavailable(scope, receive, send):
        await JSONResponse(
            {"code": "agent_maintenance", "message": "正在更新服务，请稍后继续。"},
            status_code=503,
            headers={"Retry-After": "30", "Cache-Control": "no-store"},
        )(scope, receive, send)
