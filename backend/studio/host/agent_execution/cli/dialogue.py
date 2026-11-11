"""Run one dialogue turn with caller-owned tools and events."""

import os
import sys
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.config.settings import REPO_ROOT
from studio.runtime.operation_errors import OperationError

from .codex_profile import profile_path
from .conversation import claude, codex
from .native import converse
from .tool_relay import ToolRelay


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
):
    supervisor = watchdog()
    if agent == "codex":
        image_input = await codex_image_input(image_attachments, call)
        return await codex(
            executable,
            profile_path(runtime_path),
            model,
            prompt,
            tools,
            call,
            emit,
            watchdog=supervisor,
            instructions=instructions,
            reasoning_effort=reasoning_effort,
            service_tier=service_tier,
            image_input=image_input,
        )
    with ExitStack() as cleanup:
        if root is None:
            root = Path(cleanup.enter_context(TemporaryDirectory(prefix="fpl-dialogue-")))
        relay = ToolRelay(tools, call, emit, timeout=tool_timeout)
        try:
            config = await relay.start()
            if agent == "claude-code":
                return await claude(
                    executable,
                    root,
                    model,
                    prompt,
                    config,
                    emit,
                    watchdog=supervisor,
                    reasoning_effort=reasoning_effort,
                )
            return await converse(
                agent,
                executable,
                root,
                model,
                prompt,
                config,
                emit,
                watchdog=supervisor,
                instructions=instructions,
                reasoning_effort=reasoning_effort,
                model_variant=model_variant,
                harness_effort=harness_effort,
            )
        finally:
            await relay.close()
