from __future__ import annotations

import io
import json
import re
import textwrap
import zipfile
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from studio.apps.model_service.providers.chat_completions import (
    OPENAI_CHAT_KINDS,
    TEXT_PROVIDER_KINDS,
    chat_base_url,
    chat_request_options,
)
from studio.apps.model_service.storage.models.call_log import LlmCallLog


class ReproductionUnavailableError(ValueError):
    pass


@dataclass(frozen=True)
class ReproductionBundle:
    filename: str
    content: bytes


SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "x-api-key",
    "cookie",
    "set-cookie",
}
SECRET_TEXT_PATTERNS = (
    re.compile(r"(?i)((?:authorization|x-api-key|api[_-]?key)\s*[:=]\s*(?:bearer\s+)?)([^\s,;]+)"),
    re.compile(r"(?i)\bsk-[a-z0-9_-]{8,}\b"),
)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if str(key).lower() in SECRET_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        result = value
        for pattern in SECRET_TEXT_PATTERNS:
            result = pattern.sub(
                lambda match: (
                    f"{match.group(1)}[REDACTED]" if match.lastindex == 2 else "[REDACTED]"
                ),
                result,
            )
        return result
    return value


def _safe_base_url(value: str, fallback: str) -> str:
    if not value:
        return fallback
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return fallback
    host = parsed.hostname
    if ":" in host:
        host = f"[{host}]"
    try:
        port = parsed.port
    except ValueError:
        return fallback
    if port:
        host = f"{host}:{port}"
    return urlunsplit((parsed.scheme, host, parsed.path.rstrip("/"), "", ""))


def reproduction_support(row: LlmCallLog) -> tuple[bool, str]:
    payload = dict(row.request_payload or {})
    if row.provider_kind not in TEXT_PROVIDER_KINDS:
        return False, "该供应商日志没有保存可直接重放的 HTTP 文本请求。"
    if payload.get("mode") == "realtime_voice":
        return False, "实时语音日志不保存转写正文和音频，无法生成等价复现请求。"
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        return False, "该日志没有保存完整消息列表，无法生成等价复现请求。"
    for message in messages:
        if not isinstance(message, dict):
            return False, "日志中的消息格式不完整。"
        if message.get("attachments"):
            return False, "日志只保存了附件元数据，没有原始附件内容。"
    return True, ""


def _tools(payload: dict[str, Any], provider_kind: str) -> list[dict[str, Any]]:
    source = payload.get("tools")
    if not isinstance(source, list):
        return []
    result: list[dict[str, Any]] = []
    for item in source:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        if provider_kind in OPENAI_CHAT_KINDS:
            result.append(
                {
                    "type": "function",
                    "function": {
                        "name": str(item["name"]),
                        "description": str(item.get("description") or ""),
                        "parameters": item.get("input_schema") or {},
                    },
                }
            )
        else:
            result.append(
                {
                    "name": str(item["name"]),
                    "description": str(item.get("description") or ""),
                    "input_schema": item.get("input_schema") or {},
                }
            )
    return result


def _request_body(row: LlmCallLog) -> tuple[str, dict[str, Any], list[str]]:
    payload = dict(row.request_payload or {})
    raw_messages = payload.get("messages") or []
    messages = [
        {
            "role": str(message.get("role") or "user"),
            "content": message.get("content") or "",
        }
        for message in raw_messages
        if isinstance(message, dict)
    ]
    temperature = payload.get("temperature")
    max_tokens = payload.get("max_tokens")
    system = str(payload.get("system") or payload.get("system_prompt") or "")
    warnings: list[str] = []
    tools = _tools(payload, row.provider_kind)
    if tools:
        warnings.append("复现脚本只重放首个模型 HTTP 请求，不执行模型返回的本地工具调用。")

    if row.provider_kind in OPENAI_CHAT_KINDS:
        if system:
            messages.insert(0, {"role": "system", "content": system})
        body: dict[str, Any] = {
            "model": row.model,
            "messages": messages,
            **chat_request_options(row.provider_kind),
        }
        endpoint = "/chat/completions"
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if tools:
            body.update({"tools": tools, "tool_choice": "auto"})
        return endpoint, body, warnings

    body = {
        "model": row.model,
        "messages": [message for message in messages if message["role"] != "system"],
        "max_tokens": int(max_tokens) if isinstance(max_tokens, int) else 1024,
    }
    endpoint = "/messages"
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature
    if tools:
        body.update({"tools": tools, "tool_choice": {"type": "auto"}})
    return endpoint, body, warnings


RUNNER = r'''#!/usr/bin/env python3
"""无第三方依赖的模型调用复现脚本。"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "request.json").read_text(encoding="utf-8"))


def arguments():
    parser = argparse.ArgumentParser(description="重复发送脱敏后的模型请求并保存结果")
    parser.add_argument("--mode", choices=("sync", "async"), default="sync")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--interval-ms", type=int, default=0)
    parser.add_argument("--max-response-bytes", type=int, default=10 * 1024 * 1024)
    parser.add_argument("--output-dir", default="results")
    return parser.parse_args()


def request_headers():
    key = os.environ.get(CONFIG["api_key_env"], "")
    headers = {"Content-Type": "application/json", "User-Agent": "future-props-repro/1"}
    if CONFIG["provider_kind"] == "anthropic":
        if key:
            headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
    elif key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def target_url():
    base = os.environ.get("REPRO_BASE_URL", CONFIG["base_url"]).rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("REPRO_BASE_URL 必须是有效的 HTTP(S) 地址")
    return base + CONFIG["endpoint"]


def one_call(index, args):
    started = time.perf_counter()
    started_at = datetime.now(UTC).isoformat()
    request = urllib.request.Request(
        target_url(),
        data=json.dumps(CONFIG["body"], ensure_ascii=False).encode("utf-8"),
        headers=request_headers(),
        method="POST",
    )
    status = 0
    response_headers = {}
    raw = b""
    error = ""
    truncated = False
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            status = int(response.status)
            response_headers = dict(response.headers.items())
            raw = response.read(args.max_response_bytes + 1)
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        response_headers = dict(exc.headers.items()) if exc.headers else {}
        raw = exc.read(args.max_response_bytes + 1)
        error = str(exc)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    if len(raw) > args.max_response_bytes:
        raw = raw[: args.max_response_bytes]
        truncated = True
    text = raw.decode("utf-8", errors="replace")
    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text
    latency_ms = max(0, round((time.perf_counter() - started) * 1000))
    return {
        "index": index,
        "ok": 200 <= status < 300 and not error,
        "status": status,
        "latency_ms": latency_ms,
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "response_headers": response_headers,
        "response_body": body,
        "response_truncated": truncated,
        "error": error,
    }


async def async_calls(args):
    semaphore = asyncio.Semaphore(args.concurrency)

    async def run(index):
        async with semaphore:
            if args.interval_ms:
                await asyncio.sleep((index - 1) * args.interval_ms / 1000)
            return await asyncio.to_thread(one_call, index, args)

    return await asyncio.gather(*(run(index) for index in range(1, args.count + 1)))


def sync_calls(args):
    results = []
    for index in range(1, args.count + 1):
        results.append(one_call(index, args))
        if args.interval_ms and index < args.count:
            time.sleep(args.interval_ms / 1000)
    return results


def percentile(values, fraction):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def main():
    args = arguments()
    if not 1 <= args.count <= 10000:
        raise SystemExit("--count 必须在 1 到 10000 之间")
    if not 1 <= args.concurrency <= 200:
        raise SystemExit("--concurrency 必须在 1 到 200 之间")
    run_dir = ROOT / args.output_dir / datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    run_dir.mkdir(parents=True, exist_ok=False)
    results = asyncio.run(async_calls(args)) if args.mode == "async" else sync_calls(args)
    for result in results:
        (run_dir / f"call-{result['index']:05d}.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            f"[{result['index']:05d}] status={result['status']} "
            f"latency={result['latency_ms']}ms ok={result['ok']}"
        )
    latencies = [item["latency_ms"] for item in results]
    summary = {
        "mode": args.mode,
        "count": len(results),
        "successes": sum(bool(item["ok"]) for item in results),
        "failures": sum(not item["ok"] for item in results),
        "latency_ms": {
            "min": min(latencies, default=0),
            "mean": round(statistics.fmean(latencies), 2) if latencies else 0,
            "p50": percentile(latencies, 0.5),
            "p95": percentile(latencies, 0.95),
            "max": max(latencies, default=0),
        },
        "result_directory": str(run_dir),
    }
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
'''


def _readme(row: LlmCallLog, warnings: list[str]) -> str:
    warning_text = "\n".join(f"- {item}" for item in warnings) or "- 无。"
    return textwrap.dedent(
        f"""\
        # 模型调用复现包

        来源日志：`{row.id}`  
        Trace ID：`{row.trace_id}`  
        供应商协议：`{row.provider_kind}`  
        模型：`{row.model}`  
        原始状态：`{row.status}`，耗时 `{row.latency_ms} ms`

        ## 安全说明

        包内不包含 API Key、Cookie 或 Authorization。`request.json` 和
        `expected-response.json` 可能包含业务提示词与模型回复，转交前请按团队规则检查。

        ## 运行环境

        只需要 Python 3.11+，脚本仅使用标准库，无需安装依赖。

        macOS / Linux：

        ```bash
        export REPRO_API_KEY='测试密钥'
        python3 run_repro.py --mode sync --count 1
        ```

        Windows PowerShell：

        ```powershell
        $env:REPRO_API_KEY='测试密钥'
        python run_repro.py --mode sync --count 1
        ```

        如果需要改用测试网关，可设置 `REPRO_BASE_URL`，例如：

        ```bash
        export REPRO_BASE_URL='https://gateway.example.com/v1'
        ```

        ## 批量模式

        同步串行调用 20 次，每次间隔 200 ms：

        ```bash
        python3 run_repro.py --mode sync --count 20 --interval-ms 200
        ```

        异步并发调用 100 次，并发上限 10：

        ```bash
        python3 run_repro.py --mode async --count 100 --concurrency 10
        ```

        常用参数可通过 `python3 run_repro.py --help` 查看。每次运行会在 `results/时间戳/`
        下生成逐次响应和 `summary.json`，汇总成功率以及 min / mean / p50 / p95 / max 延迟。
        HTTP 非 2xx 或网络错误会保留响应正文并令脚本返回非零退出码。

        ## 复现边界

        {warning_text}
        - 脚本重放的是日志中保存的脱敏请求快照，不会读取 Future Props Lab 数据库。
        - 多次调用会产生真实的供应商费用和限流，请先使用小批量及测试凭证。
        """
    )


def build_reproduction_bundle(row: LlmCallLog, *, base_url: str) -> ReproductionBundle:
    supported, reason = reproduction_support(row)
    if not supported:
        raise ReproductionUnavailableError(reason)
    endpoint, body, warnings = _request_body(row)
    default_url = (
        chat_base_url(row.provider_kind, "")
        if row.provider_kind in OPENAI_CHAT_KINDS
        else "https://api.anthropic.com/v1"
    )
    request = {
        "schema_version": 1,
        "provider_kind": row.provider_kind,
        "base_url": _safe_base_url(base_url, default_url),
        "endpoint": endpoint,
        "api_key_env": "REPRO_API_KEY",
        "body": _redact(body),
        "source": {
            "log_id": row.id,
            "trace_id": row.trace_id,
            "call_source": row.call_source,
            "created_at": row.created_at.isoformat() + "Z",
        },
        "warnings": warnings,
    }
    expected = {
        "status": row.status,
        "latency_ms": row.latency_ms,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "error_message": _redact(row.error_message),
        "response_payload": _redact(row.response_payload or {}),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.md", _readme(row, warnings))
        archive.writestr("request.json", json.dumps(request, ensure_ascii=False, indent=2))
        archive.writestr(
            "expected-response.json", json.dumps(expected, ensure_ascii=False, indent=2)
        )
        archive.writestr("run_repro.py", RUNNER)
        archive.writestr(
            ".env.example",
            "# 脚本不会自动读取此文件，请按 README 设置环境变量。\n"
            "REPRO_API_KEY=\n"
            f"REPRO_BASE_URL={request['base_url']}\n",
        )
    return ReproductionBundle(
        filename=f"model-repro-{row.id[:8]}.zip",
        content=buffer.getvalue(),
    )
