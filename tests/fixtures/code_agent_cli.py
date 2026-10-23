"""Disposable Codex app-server used by the Electron acceptance journey; no network."""

import json
import sys
from pathlib import Path


def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def tool(identity, name, arguments):
    send(
        {
            "id": identity,
            "method": "item/tool/call",
            "params": {
                "callId": identity,
                "tool": name,
                "arguments": arguments,
            },
        }
    )
    for line in sys.stdin:
        response = json.loads(line)
        if response.get("id") == identity:
            assert response["result"]["success"], response
            return json.loads(response["result"]["contentItems"][0]["text"])
    raise RuntimeError("task connection closed")


def main():
    if "--version" in sys.argv:
        print("codex-cli 0.163.0")
        return
    if sys.argv[1:3] == ["login", "status"]:
        return
    assert "app-server" in sys.argv
    assert "features.shell_tool=false" in sys.argv
    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method")
        if method == "initialize":
            send({"id": request["id"], "result": {}})
        elif method == "model/list":
            send({"id": request["id"], "result": {"data": []}})
        elif method == "thread/start":
            assert request["params"]["ephemeral"]
            send({"id": request["id"], "result": {"thread": {"id": "desktop-fake"}}})
        elif method == "turn/start":
            send({"id": request["id"], "result": {"turn": {"id": "desktop-fake-turn"}}})
            content = request["params"]["input"][0]["text"]
            snapshot = json.loads(content.split("\n", 1)[1])
            scenario = json.loads(Path(sys.argv[0]).with_suffix(".json").read_text())
            project = scenario["project_id"]
            tool("discover", "operations", {"resource": "visual"})
            canvas = tool(
                "read",
                "call",
                {
                    "operation": "visual.get_canvas",
                    "arguments": {"path_params": {"project_id": project}},
                },
            )["result"]
            if snapshot["mode"] == "plan":
                tool(
                    "plan",
                    "present_artifact",
                    {
                        "kind": "plan",
                        "title": "日落城市镜头草稿计划",
                        "body": "先核对画布，再展示变更并等待批准。",
                        "steps": [
                            {"title": "新增视频草稿", "detail": "读取最新版本并提交参数绑定审批"}
                        ],
                    },
                )
                text = "计划已准备，等待你选择执行。"
            elif any(action["status"] == "completed" for action in snapshot["actions"]):
                assert any(n["id"] == scenario["node"]["id"] for n in canvas["nodes"])
                text = "已新增视频生成草稿，并确认当前项目状态。"
            else:
                tool(
                    "write",
                    "call",
                    {
                        "operation": "visual.apply_canvas_operations",
                        "arguments": {
                            "path_params": {"project_id": project},
                            "body": {
                                "expected_revision": canvas["revision"],
                                "request_id": "code-agent-desktop-smoke",
                                "operations": [
                                    {
                                        "entity": "node",
                                        "action": "insert",
                                        "id": scenario["node"]["id"],
                                        "value": scenario["node"],
                                    }
                                ],
                            },
                        },
                    },
                )
                text = "修改提案等待确认。"
            send({"method": "item/agentMessage/delta", "params": {"delta": text}})
            send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
            return


if __name__ == "__main__":
    main()
