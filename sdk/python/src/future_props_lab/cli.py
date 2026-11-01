"""Stable machine-readable CLI over the same generated SDK used by Python callers."""

import argparse
import getpass
import inspect
import json
import mimetypes
import os
import sys
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path

import httpx
from pydantic import BaseModel

from .errors import ApiError, TaskFailed, TaskTimeout
from .streams import Download, EventStream
from .website import WebsiteConnectionError, connect_website, disconnect_website, website_client


def emit(value, *, stream=sys.stdout):
    def encode(item):
        if isinstance(item, BaseModel):
            return item.model_dump(mode="json")
        raise TypeError(type(item).__name__)

    print(json.dumps(value, ensure_ascii=False, default=encode), file=stream, flush=True)


def parser():
    cli = argparse.ArgumentParser(prog="fpl", description="Future Props Lab 网站接入")
    cli.add_argument("--profile-dir", type=Path, help="受保护的客户端配置目录")
    cli.add_argument("--profile", default="default")
    commands = cli.add_subparsers(dest="command", required=True)
    connect = commands.add_parser("connect", help="保存网站地址和已有 Management API Key")
    connect.add_argument("--url", required=True)
    connect.add_argument("--api-key-stdin", action="store_true", help="从标准输入读取密钥")
    commands.add_parser("disconnect", help="清除本机凭据；撤销授权请在网站内操作")
    commands.add_parser("status")
    mcp = commands.add_parser("mcp", help="Serve FPL tools over stdio MCP")
    mcp.add_argument("mcp_action", choices=["serve", "relay"])
    operations = commands.add_parser("operations", help="列出操作，或查看操作参数和 schema")
    operations.add_argument("operation", nargs="?")
    for command in ("call", "wait"):
        invoke = commands.add_parser(command)
        invoke.add_argument("operation", help="resource.method")
        invoke.add_argument("--input", default="-", help="SDK 关键字参数 JSON 文件；- 表示标准输入")
        if command == "call":
            invoke.add_argument("--file", action="append", default=[], metavar="FIELD=PATH")
            invoke.add_argument("--output", type=Path)
            invoke.add_argument("--overwrite", action="store_true")
        else:
            invoke.add_argument("--timeout", type=float, default=300)
            invoke.add_argument("--interval", type=float, default=2)
    opening = commands.add_parser("open", help="在 App 中获取经过归属校验的网站资源链接")
    opening.add_argument(
        "kind",
        choices=[
            "visual",
            "galgame",
            "video",
            "presentation",
            "annotation",
            "director",
            "note",
            "knowledge",
            "skill",
            "tool-api",
            "mcp",
        ],
    )
    opening.add_argument("resource_id", nargs="?", help="资源 ID；集成列表和新建表单可省略")
    opening.add_argument(
        "--view",
        choices=["list", "details", "upload", "versions", "tags", "edit", "validate", "tools"],
        help="集成视图；只定位页面，不自动提交或校验",
    )
    opening.add_argument("--timeout", type=float, default=30)
    return cli


def inputs(value):
    if value == "-":
        raw = "{}" if sys.stdin.isatty() else sys.stdin.read()
    else:
        raw = Path(value).read_text()
    result = json.loads(raw or "{}")
    if not isinstance(result, dict):
        raise ValueError('输入必须为 SDK 关键字参数对象，例如 {"body": {...}}')
    return result


def capability(client):
    return client._call("GET", "/v1/automation/capabilities")


def operation(client, name, capabilities):
    if name not in capabilities["operations"]:
        raise ValueError("App 未开放此操作，请查看 fpl operations")
    resource, method = name.split(".", 1)
    function = getattr(getattr(client, resource, None), method, None)
    if function is None:
        raise ValueError("CLI/SDK 版本较旧，不支持此操作，请更新")
    return function


def invoke(client, args, capabilities):
    function = operation(client, args.operation, capabilities)
    kwargs = inputs(args.input)
    if "files" in kwargs:
        raise ValueError("文件只能通过 --file FIELD=PATH 显式传入")
    if args.command == "wait":
        if capabilities["operations"][args.operation]["method"] != "GET":
            raise ValueError("wait 只允许查询任务，不允许重复执行写操作")
        if args.timeout <= 0 or args.interval < 0.1:
            raise ValueError("timeout 必须为正，interval 不得小于 0.1 秒")
        deadline = time.monotonic() + args.timeout
        while True:
            result = function(**kwargs)
            data = result.model_dump() if isinstance(result, BaseModel) else result
            if not isinstance(data, dict) or "status" not in data:
                raise ValueError("wait 需要返回 status 的任务查询操作")
            status = data["status"]
            if status == "completed":
                emit(result)
                return
            if status in {"failed", "cancelled"}:
                emit({"error": "task_failed", "task": result})
                return 5
            if time.monotonic() >= deadline:
                emit({"error": "task_timeout", "task": result})
                return 6
            emit({"status": status}, stream=sys.stderr)
            time.sleep(args.interval)
    with ExitStack() as stack:
        if args.file:
            files = []
            for value in args.file:
                field, separator, filename = value.partition("=")
                if not separator or not field:
                    raise ValueError("文件参数应为 FIELD=PATH")
                file = Path(filename)
                files.append(
                    (
                        field,
                        (
                            file.name,
                            stack.enter_context(file.open("rb")),
                            mimetypes.guess_type(file.name)[0] or "application/octet-stream",
                        ),
                    )
                )
            kwargs["files"] = files
        inspect.signature(function).bind(**kwargs)
        output = None
        temporary = None
        if args.output:
            if args.output.exists() and not args.overwrite:
                raise FileExistsError("输出文件已存在；请指定其他路径或显式使用 --overwrite")
            descriptor, temporary = tempfile.mkstemp(
                prefix=".fpl-download-", dir=args.output.parent
            )
            stack.callback(lambda: os.unlink(temporary) if os.path.exists(temporary) else None)
            output = stack.enter_context(os.fdopen(descriptor, "wb"))
        result = function(**kwargs)
        if isinstance(result, Download):
            with result:
                if output is None:
                    raise ValueError("下载操作必须指定 --output PATH")
                for chunk in result.iter_bytes():
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if args.overwrite:
                os.replace(temporary, args.output)
            else:
                os.link(temporary, args.output)
            emit({"saved": str(args.output.resolve())})
        elif isinstance(result, EventStream):
            with result:
                for event in result:
                    emit(event)
        else:
            if output is not None:
                raise ValueError("此操作返回 JSON，不接受 --output；结果从标准输出读取")
            emit(result)


def main(argv=None):
    args = parser().parse_args(argv)
    options = dict(profile_dir=args.profile_dir, profile=args.profile)
    try:
        if args.command == "mcp":
            from .mcp import run_external, run_relay

            if args.mcp_action == "relay":
                run_relay()
            else:
                run_external(**options)
            return 0
        if args.command == "connect":
            key = (
                sys.stdin.readline().strip()
                if args.api_key_stdin
                else getpass.getpass("Management API Key: ")
            )
            emit(connect_website(url=args.url, api_key=key, **options))
            return 0
        if args.command == "disconnect":
            disconnect_website(**options)
            emit(
                {"disconnected": True, "note": "已清除本机凭据；服务端授权可在 网站 API 密钥页撤销"}
            )
            return 0
        with website_client(**options) as client:
            capabilities = capability(client)
            if args.command == "status":
                emit({key: capabilities[key] for key in ("version", "user_id", "scopes")})
            elif args.command == "operations":
                if args.operation:
                    function = operation(client, args.operation, capabilities)
                    emit(
                        {
                            "operation": capabilities["operations"][args.operation],
                            "sdk_parameters": str(inspect.signature(function)),
                            "schemas": capabilities["schemas"],
                        }
                    )
                else:
                    emit(
                        {
                            "version": capabilities["version"],
                            "operations": sorted(capabilities["operations"]),
                        }
                    )
            elif args.command == "open":
                result = client._call(
                    "POST",
                    "/v1/automation/open",
                    body={"kind": args.kind, "resource_id": args.resource_id, "view": args.view},
                    media_type="application/json",
                )
                result["url"] = client.base_url + result["path"]
                emit(result)
            else:
                return invoke(client, args, capabilities) or 0
        return 0
    except ApiError as exc:
        # Do not echo request bodies or server-provided details that may include secrets.
        emit({"error": exc.code, "status": exc.status}, stream=sys.stderr)
        return 3 if exc.status in {401, 403} else 4
    except (TaskFailed, TaskTimeout):
        emit({"error": "task_incomplete"}, stream=sys.stderr)
        return 5
    except httpx.TransportError:
        emit(
            {"error": "connection_lost", "message": "网站连接中断；写操作未自动重试，请查询结果"},
            stream=sys.stderr,
        )
        return 7
    except (OSError, ValueError, TypeError, WebsiteConnectionError) as exc:
        emit({"error": "invalid_input_or_connection", "message": str(exc)}, stream=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
