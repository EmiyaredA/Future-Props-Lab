from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

try:
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from management_api import management_api_key


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过正式 API 将广播剧标注导入 Galgame Story")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--audit-out", type=Path)
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    return parser.parse_args()


def request_json(
    client: httpx.Client, method: str, path: str, *, payload: dict | None = None
) -> dict:
    response = client.request(method, path, json=payload)
    if response.is_error:
        raise RuntimeError(f"API {method} {path} 返回 {response.status_code}: {response.text}")
    return response.json()


def main() -> None:
    args = parse_args()
    secret = management_api_key()
    request_body = json.loads(args.request.read_text(encoding="utf-8"))
    project_path = f"/v1/galgame-workshop/projects/{args.project_id}/annotation-imports"
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {secret}"},
        timeout=None,
    ) as client:
        preview = request_json(client, "POST", f"{project_path}/preview", payload=request_body)
        if not preview.get("ready"):
            raise RuntimeError(
                "导入预览未通过："
                + "；".join(issue.get("message", "未知错误") for issue in preview["issues"])
            )
        task = request_json(client, "POST", project_path, payload=request_body)
        while task["status"] in {"queued", "running"}:
            time.sleep(max(0.2, args.poll_seconds))
            task = request_json(client, "GET", f"{project_path}/{task['id']}")

    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")
    audit_path = args.audit_out or Path(
        f".runtime/galgame-import-backups/{stamp}-annotation-import-audit.json"
    )
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit = {"preview": preview, "task": task}
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if task["status"] != "completed":
        raise RuntimeError(f"导入未完成，状态为 {task['status']}；审计文件：{audit_path}")
    print(json.dumps({"status": task["status"], "audit": str(audit_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
