"""Run an explicitly prepared backend cutover and rollback with the Agent gate closed."""

import argparse
import json
import subprocess
from pathlib import Path

from studio.host.deployment.agent_cutover import CutoverDeferred, cutover, pending_work


def execute(arguments):
    return subprocess.run(arguments, capture_output=True, text=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, help="local JSON with database paths and command arrays")
    parser.add_argument("--check", action="store_true", help="read-only work inventory")
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    root = Path(plan["admission_dir"]).resolve(strict=True)
    databases = {name: Path(path) for name, path in plan["databases"].items()}

    def verify_gate(challenge):
        probes = plan["admission_probes"]
        if set(probes) != set(databases):
            raise ValueError("必须探测两个 Agent 服务的实际入口状态")
        for service, command in probes.items():
            result = json.loads(execute(command))
            if (
                result.get("service") != service
                or result.get("agent_admission") != "paused"
                or result.get("agent_admission_id") != challenge
            ):
                raise CutoverDeferred(f"{service} 尚未连接到已暂停的发布入口")

    try:
        if args.check:
            active = pending_work(databases)
            print(json.dumps(active, ensure_ascii=False))
            if active:
                parser.exit(2)
            return
        cutover(
            root,
            databases,
            verify_gate=verify_gate,
            switch=lambda: execute(plan["switch"]),
            verify_health=lambda: execute(plan["health"]),
            rollback=lambda: execute(plan["rollback"]),
        )
    except CutoverDeferred as cause:
        parser.exit(2, f"{cause}\n")
    except (subprocess.SubprocessError, OSError, ValueError) as cause:
        phase = "入口仍暂停，请核查回退与健康检查" if (root / "paused").exists() else "任务入口正常"
        parser.exit(1, f"发布流程失败：{type(cause).__name__}；{phase}\n")


if __name__ == "__main__":
    main()
