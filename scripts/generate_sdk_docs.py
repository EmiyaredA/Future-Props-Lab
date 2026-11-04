"""Build module reference pages and API-to-SDK coverage links from the checked-in contract."""

import argparse
import ast
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    "code_agents": "编程智能体连接",
    "interview": "面试资料准备",
    "automation": "网站自动化接入与资源定位",
    "amadeus": "Amadeus 网页助手",
    "motion_compositor": "特效制作工坊",
    "accounts": "登录与个人账号",
    "workspaces": "工作区与邀请",
    "admin": "账号管理",
    "governance": "平台治理",
    "templates": "模型模板",
    "models": "模型目录",
    "logs": "调用日志",
    "testing": "模型测试",
    "inference": "独立模型调用",
    "files": "文件管理",
    "integrations": "集成中心",
    "creative_workshop": "创意工坊",
    "tools": "工具导航",
    "visual": "视觉工坊",
    "generation": "工坊生成任务",
    "visual_assistant": "视觉助手",
    "galgame": "Galgame 工坊",
    "video": "视频剪辑",
    "thought": "思绪工坊",
    "annotation": "录音标注",
    "presentation": "演示工坊",
    "director": "导演台",
    "public": "公开展台",
    "demo": "演示服务管理",
    "demo_calls": "演示服务调用",
    "system": "健康检查",
}


def type_label(schema):
    if "$ref" in schema:
        return schema["$ref"].split("/")[-1]
    if "enum" in schema:
        return " / ".join(str(v) for v in schema["enum"])
    if "anyOf" in schema or "oneOf" in schema:
        return " / ".join(type_label(v) for v in schema.get("anyOf", schema.get("oneOf", [])))
    return schema.get("type", "object")


def auth_for(path, _method="GET"):
    if path.startswith("/v1/amadeus/"):
        return "浏览器 Session；不接受 Management API Key"
    if path.startswith("/v1/tool-navigation/codex-source"):
        return "仅本机网站入口；平台管理员 Session；不接受 Management API Key 或 Agent 通道"
    if path.startswith("/v1/automation/access"):
        return "仅本机网站入口；平台管理员 Session；公网拒绝访问"
    if path in {"/health", "/ready"}:
        return "无需登录"
    if path == "/v1/auth/login":
        return "账号密码"
    if path == "/v1/auth/register":
        return "有效注册邀请码；无需已有 Session"
    if path.startswith("/v1/public-workspace"):
        return "Session 或具有 studio:read 的 Management API Key；仅公开只读投影"
    if path.startswith(("/v1/auth", "/v1/account", "/v1/platform")):
        return "Session；敏感操作需要二次验证"
    if path.startswith("/v1/code-agents"):
        if path.endswith("/enable"):
            return "可信本机管理员 Session；需要近期密码重验"
        return "浏览器 Session"
    return "Management API Key 或 Session；按当前账号固定权限校验"


def permission_map():
    tree = ast.parse((ROOT / "backend/app/capabilities/identity/route_permissions.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "OPERATIONS":
            return {
                method + " " + path: permission
                for permission, entries in ast.literal_eval(node.value).items()
                for method, path in entries
            }
    raise ValueError("Missing permission registry")


def example_page():
    source = (ROOT / "sdk/python/src/future_props_lab/examples.py").read_text()
    tree = ast.parse(source)
    snippets = {
        node.name: ast.get_source_segment(source, node)
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    imports = "from future_props_lab.builders import presentation_document\n\n"
    meta = {
        "category": "sdk",
        "group": "sdk-start",
        "order": 3,
        "title": "首次创建演示文稿",
        "lead": "从可执行 SDK 样例提取的同步与异步调用。",
        "evidence": ["sdk/python/src/future_props_lab/examples.py", "tests/test_python_sdk.py"],
        "prerequisites": "已安装 SDK，并持有当前工作区的 content.write 权限。",
        "related": ["sdk-quickstart", "sdk-editing", "sdk-reference-presentation"],
        "examples": {
            "sync": imports + snippets["create_deck"],
            "async": imports + snippets["create_deck_async"],
            "curl": 'curl -X POST "$FPL_URL/v1/presentation-workshop/projects" \\\n'
            '  -H "Authorization: Bearer $FPL_API_KEY" -H "Content-Type: application/json" \\\n'
            "  --data-binary @presentation.json",
        },
    }
    return (
        "<!-- docs: "
        + json.dumps(meta, ensure_ascii=False)
        + " -->\n\n# 首次创建演示文稿\n\n## 准备客户端\n\n"
        "按安装与认证教程创建 Client 或 AsyncClient，再将客户端传给下方函数。"
        "cURL 的 presentation.json 包含相同 title 和 document 请求体。\n\n## 查看结果\n\n"
        "返回的 id 可在网页演示工坊中打开；后续编辑从返回的 revision 开始。\n"
    )


def workflow_pages(mapping):
    source_path = "sdk/python/src/future_props_lab/workshop_examples.py"
    source = (ROOT / source_path).read_text()
    tree = ast.parse(source)
    methods = {f"client.{item['resource']}.{item['method']}": key for key, item in mapping.items()}
    metadata = {
        "group": "sdk-workshops",
        "category": "sdk",
        "order": 5,
        "title": "六个工坊的完整样例",
        "lead": "从创建、细粒度编辑到读取和导出。",
        "evidence": [source_path, "tests/test_sdk_workflows.py"],
        "prerequisites": (
            "Python 3.11+；工作区密钥有 content.write；已创建输出目录。录音示例需要 WAV 输入。"
        ),
        "related": ["sdk-editing", "sdk-files", "sdk-errors"],
    }
    lines = [
        "<!-- docs: " + json.dumps(metadata, ensure_ascii=False) + " -->",
        "",
        "# 六个工坊的完整样例",
        "",
        "这些函数随 SDK 安装，由 tests/test_sdk_workflows.py 在隔离服务端执行。"
        "传入 AsyncClient 和明确的输出路径，返回资源 ID 与最新保存内容。",
        "",
        "视觉、Galgame 与剪辑导出可重新导入的项目包；思绪导出 Markdown，"
        "演示导出 PPTX，录音标注导出 SRT。视频成片另用 create_render 与下载结果接口。",
        "",
        "测试同时使用网页所消费的正式读取接口验证修改可见；"
        "这里的六条流程验证不代表每一种编辑组合均已覆盖。",
        "",
        "## 共用导入",
        "",
        "```python",
        "from uuid import uuid4",
        (
            "from future_props_lab.builders import edit_batch, entity_edit, "
            "note_document, presentation_document, text_node"
        ),
        "```",
        "",
    ]
    inventory = []
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        resource = node.name.removesuffix("_workflow")
        calls = sorted(
            {
                ast.unparse(call.func)
                for call in ast.walk(node)
                if isinstance(call, ast.Call) and ast.unparse(call.func).startswith("client.")
            }
        )
        for call in calls:
            if call not in methods:
                raise ValueError("Unknown SDK workflow method: " + call)
        lines += [
            "## " + LABELS[resource],
            "",
            "```python",
            ast.get_source_segment(source, node),
            "```",
            "",
        ]
        inventory.append(
            {
                "workshop": resource,
                "example": source_path + "::" + node.name,
                "sdk_methods": calls,
                "http_operations": [methods[call] for call in calls],
                "document": "/docs.html?page=sdk-workflow-examples",
                "test": "tests/test_sdk_workflows.py::test_sdk_workshop_create_edit_read_export",
                "evidence": "create-edit-read-export; same HTTP reads as Web",
            }
        )
    return {
        ROOT / "web/src/docs/articles/sdk/sdk-workflow-examples.md": "\n".join(lines) + "\n",
        ROOT / "sdk/python/workflows.json": json.dumps(inventory, indent=2, ensure_ascii=False)
        + "\n",
    }


def build():
    schema = json.loads((ROOT / "web/src/generated/openapi.json").read_text())
    mapping = json.loads((ROOT / "sdk/python/operations.json").read_text())
    groups = defaultdict(list)
    for key, value in mapping.items():
        groups[value["resource"]].append((key, value))
    pages, coverage = workflow_pages(mapping), []
    permissions = permission_map()
    for index, (resource, operations) in enumerate(sorted(groups.items())):
        label = LABELS.get(resource, resource)
        page_id = "sdk-reference-" + resource.replace("_", "-")
        meta = {
            "group": "api-modules",
            "category": "api",
            "order": index,
            "title": label + "方法参考",
            "lead": f"client.{resource} 的具名方法与 HTTP 接口。",
            "evidence": ["sdk/python/operations.json"],
            "related": ["sdk-auth", "sdk-errors"],
        }
        lines = [
            "<!-- docs: " + json.dumps(meta, ensure_ascii=False) + " -->",
            "",
            f"# {label}方法参考",
            "",
            f"通过 `client.{resource}` 访问这些业务操作。同步与异步方法名称和参数一致；"
            "异步调用增加 `await`。",
            "所有方法均来自当前 OpenAPI 与稳定映射表。"
            "下表验证的是接口契约覆盖，完整业务流程另见工坊教程。",
            "",
            "## 方法目录",
            "",
            "| SDK 方法 | HTTP 操作 |",
            "| --- | --- |",
        ]
        for key, entry in operations:
            lines.append(f"| [{entry['method']}](#{entry['method'].replace('_', '-')}) | `{key}` |")
        for key, entry in operations:
            method, path = key.split(" ", 1)
            op = schema["paths"][path][method.lower()]
            anchor = entry["method"].replace("_", "-")
            lines += [
                "",
                f"## {entry['method']} {{#{anchor}}}",
                "",
                f"`client.{resource}.{entry['method']}(...)`",
                "",
                f"**接口**：`{key}`。**鉴权**：{auth_for(path, method)}。",
                f"**权限**：`{permissions.get(key, '账号治理或公开接口的专用鉴权')}`。",
                "",
                "写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；"
                "409 冲突不会自动覆盖。",
                "SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。",
                "",
                "| 参数 | 位置 | 类型 | 必填 |",
                "| --- | --- | --- | --- |",
            ]
            for p in op.get("parameters", []):
                lines.append(
                    f"| `{p['name']}` | {p['in']} | {type_label(p['schema'])} | "
                    f"{'是' if p.get('required') else '否'} |"
                )
            content = op.get("requestBody", {}).get("content", {})
            for media, value in content.items():
                request = value.get("schema", {})
                lines.append(
                    f"| `body` | {media} | {type_label(request)} | "
                    f"{'是' if op['requestBody'].get('required') else '否'} |"
                )
                if "$ref" in request:
                    request = schema["components"]["schemas"][request["$ref"].split("/")[-1]]
                for name, field in request.get("properties", {}).items():
                    lines.append(
                        f"| `body.{name}` | 请求体 | {type_label(field)} | "
                        f"{'是' if name in request.get('required', []) else '否'} |"
                    )
                if media == "multipart/form-data":
                    lines += [
                        "",
                        "文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；"
                        "其他表单字段放在 `body`。",
                    ]
            lines += ["", "**响应**："]
            for status, response in op.get("responses", {}).items():
                if status.startswith("2"):
                    for media, value in response.get("content", {}).items():
                        lines.append(
                            f"- `{status}` · `{media}` · `{type_label(value.get('schema', {}))}`"
                        )
                    if not response.get("content"):
                        lines.append(f"- `{status}` · 无内容或由接口声明的文件响应。")
            lines += [
                "",
                "上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。",
            ]
            coverage.append(
                {
                    "http": key,
                    "sdk": f"client.{resource}.{entry['method']}",
                    "document": f"/docs.html?page={page_id}#{anchor}",
                    "contract_test": "tests/test_python_sdk.py::"
                    "test_every_named_operation_reaches_declared_http_route",
                    "verification": "named-operation-contract",
                }
            )
        pages[ROOT / "web/src/docs/articles/sdk" / (page_id + ".md")] = "\n".join(lines) + "\n"
    pages[ROOT / "sdk/python/coverage.json"] = (
        json.dumps(coverage, indent=2, ensure_ascii=False) + "\n"
    )
    pages[ROOT / "web/src/docs/articles/sdk/sdk-first-call.md"] = example_page()
    return pages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    stale = []
    for path, content in build().items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    if stale:
        raise SystemExit("Stale SDK docs: " + ", ".join(stale))


if __name__ == "__main__":
    main()
