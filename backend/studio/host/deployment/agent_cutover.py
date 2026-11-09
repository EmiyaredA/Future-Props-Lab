"""Execute a backend cutover only while Agent work is idle."""

import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from studio.runtime.http.agent_admission import INFLIGHT, PAUSE, admission_status

QUERIES = {
    "amadeus": {
        "运行或取消": "SELECT count(*) FROM amadeus_runs WHERE status IN ('running', 'cancelling')",
        "审批或操作": (
            "SELECT count(*) FROM amadeus_actions WHERE status IN ('pending','approved','running')"
        ),
        "待回答": "SELECT count(*) FROM amadeus_questions WHERE status = 'pending'",
        "原生任务": "SELECT count(*) FROM amadeus_native_jobs WHERE status IN ('queued','leased')",
    },
    "agent-runtime": {
        "连接任务": (
            "SELECT count(*) FROM agent_runtime_connection_jobs WHERE status IN ('queued','leased')"
        ),
        "视觉评审": (
            "SELECT count(*) FROM agent_runtime_visual_review_jobs "
            "WHERE status IN ('queued','leased')"
        ),
    },
}


def pending_work(databases: dict[str, Path]):
    if set(databases) != QUERIES.keys():
        raise ValueError("必须检查 Amadeus 和 Agent Runtime 的运行数据库")
    active = {}
    for service, queries in QUERIES.items():
        uri = databases[service].resolve(strict=True).as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=3)) as db:
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
            for label, query in queries.items():
                count = db.execute(query).fetchone()[0]
                if count:
                    active[f"{service} · {label}"] = count
    return active


class CutoverDeferred(RuntimeError):
    pass


def cutover(root, databases, *, verify_gate, switch, verify_health, rollback):
    """The supplied probes verify both deployed services against this exact gate."""
    if admission_status(root) != "accepting":
        raise CutoverDeferred("任务入口未初始化，或已有发布正在进行")

    def require_idle():
        active = pending_work(databases)
        if active:
            raise CutoverDeferred(f"仍有 Agent 工作，已延后切换：{active}")

    require_idle()
    pause = root / PAUSE
    challenge = uuid4().hex
    try:
        with pause.open("x") as file:
            file.write(challenge + "\n")
    except FileExistsError:
        raise CutoverDeferred("另一项发布已暂停任务入口") from None

    started = False
    safe_to_resume = True
    try:
        verify_gate(challenge)
        if next((root / INFLIGHT).iterdir(), None) is not None:
            raise CutoverDeferred("仍有请求正在提交，请待其完成后重试")
        require_idle()
        started = True
        safe_to_resume = False
        switch()
        verify_health()
        verify_gate(challenge)
        safe_to_resume = True
    except Exception:
        if started:
            rollback()
            verify_health()
            verify_gate(challenge)
            safe_to_resume = True
        raise
    finally:
        if safe_to_resume:
            pause.unlink()
