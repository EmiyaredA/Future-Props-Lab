"""Run one dialogue turn with caller-owned tools and events."""

import os
import sys
from pathlib import Path

from studio.config.settings import REPO_ROOT
from studio.runtime.operation_errors import OperationError

from .codex_profile import profile_path
from .conversation import claude, codex
from .native import converse
from .tool_relay import ToolRelay
from .workspace import WORKSPACE_TOOLS, workspace


def watchdog():
    if getattr(sys, "frozen", False):
        binary = Path(sys.executable).resolve().parent.parent
        command = [str(binary / "fpl-acceptance-tools" / "fpl-acceptance-tools")]
    else:
        command = [sys.executable, str(REPO_ROOT / "scripts/website/acceptance_tools.py")]
    return [*command, "--run-agent", str(os.getpid())]


async def codex_image_input(names, call):
    parts = []
    remaining = 6 * 1024 * 1024
    for name in names:
        if remaining < 1:
            break
        try:
            [image] = await call("read_file", {"kind": "imports", "name": name})
        except OperationError as exc:
            if exc.code not in {"not_found", "unsupported_file", "image_too_large"}:
                raise
            continue
        data = image["data"]
        if len(data) > remaining:
            continue
        remaining -= len(data)
        parts.extend(
            [
                {"type": "text", "text": f"会话图片附件 {name}"},
                {"type": "image", "url": f"data:{image['mimeType']};base64,{data}"},
            ]
        )
    return parts


async def run_dialogue(
    agent,
    executable,
    model,
    prompt,
    tools,
    call,
    emit,
    *,
    runtime_path,
    root=None,
    tool_timeout=120,
    instructions=None,
    reasoning_effort=None,
    model_variant=None,
    harness_effort=None,
    service_tier=None,
    image_attachments=(),
    image_generation_enabled=False,
    save_image=None,
):
    supervisor = watchdog()
    del root  # Retain the caller contract without granting its persistent directory.
    # Never mount the caller's persistent conversation directory in a CLI process.
    async with workspace(runtime_path) as local:

        async def local_call(name, args):
            if name in {"execute_workspace", "save_workspace_file"}:
                await call("operations", {})  # reauthenticate before local effects, too
                if name == "execute_workspace":
                    return await local.execute(args)
                return await local.save(args, call)
            return await call(name, args)

        all_tools = [*tools, *WORKSPACE_TOOLS]
        task_relay = ToolRelay(tools, call, emit, timeout=tool_timeout)
        relay = ToolRelay(all_tools, local_call, emit, timeout=tool_timeout)
        try:
            local.attach(await task_relay.start())
            config = await relay.start()
            local.attach(config, task=False)
            prompt += (
                "\n[临时工作区]\n可用 execute_workspace 编写并执行脚本。"
                "Python 使用 from future_props_lab import task_client；CLI 使用 fpl --task。"
                "只可读写本轮临时目录；源码、数据库、其他会话及个人文件不可直接访问。"
                "项目、Skill 和集成通过声明的工具或任务 SDK/CLI 读取。"
                "项目写入会暂停等待审批，不要自动重跑脚本。"
                "文件在本轮结束时清理；需要保留时使用 save_workspace_file 显式保存 UTF-8 文件。"
            )
            if agent == "codex":
                if image_generation_enabled and save_image is None:
                    raise ValueError("Codex 生图缺少会话保存接口")
                image_input = await codex_image_input(image_attachments, call)
                return await codex(
                    executable,
                    profile_path(runtime_path),
                    model,
                    prompt,
                    all_tools,
                    local_call,
                    emit,
                    watchdog=supervisor,
                    sandbox=local,
                    instructions=instructions,
                    reasoning_effort=reasoning_effort,
                    service_tier=service_tier,
                    image_input=image_input,
                    save_image=save_image if image_generation_enabled else None,
                )
            if agent == "claude-code":
                return await claude(
                    executable,
                    local.root,
                    model,
                    prompt,
                    config,
                    emit,
                    watchdog=supervisor,
                    sandbox=local,
                    reasoning_effort=reasoning_effort,
                    instructions=instructions,
                )
            return await converse(
                agent,
                executable,
                local.root,
                model,
                prompt,
                config,
                emit,
                watchdog=supervisor,
                sandbox=local,
                instructions=instructions,
                reasoning_effort=reasoning_effort,
                model_variant=model_variant,
                harness_effort=harness_effort,
            )
        finally:
            await relay.close()
            await task_relay.close()
