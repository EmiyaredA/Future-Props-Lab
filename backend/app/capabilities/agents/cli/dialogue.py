"""Run one dialogue turn with caller-owned tools and events."""

import os
import sys
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory

from app.runtime.config import REPO_ROOT

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
):
    supervisor = watchdog()
    if agent == "codex":
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
        )
    with ExitStack() as cleanup:
        if root is None:
            root = Path(cleanup.enter_context(TemporaryDirectory(prefix="fpl-dialogue-")))
        relay = ToolRelay(tools, call, emit, timeout=tool_timeout)
        try:
            config = await relay.start()
            if agent == "claude-code":
                return await claude(
                    executable, root, model, prompt, config, emit, watchdog=supervisor
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
            )
        finally:
            await relay.close()
