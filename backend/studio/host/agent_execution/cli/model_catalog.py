"""Probe available models using the same isolated profiles as dialogue execution."""

import asyncio
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.agent_runtime.catalog import CLAUDE_MODEL_EFFORTS, PI_REASONING_EFFORTS

from .isolation import control_output, launch
from .native import JsonLines, acp_choices, acp_option, initialize_acp, pi_model_id, set_acp_option
from .opencode_models import OPTION_ID, read_opencode_models
from .transport import MAX_BYTES, CliError, close_transport, environment, spawn_transport

# Happier a2c45c86804b, packages/agents/src/models.ts (MIT, see Amadeus bottomFollowIntent).
CLAUDE_PRESETS = (
    ("claude-fable-5-1", "Fable 5.1"),
    ("claude-opus-5-5", "Opus 5.5"),
    ("claude-sonnet-5-5", "Sonnet 5.5"),
    ("claude-opus-5", "Opus 5"),
    ("claude-sonnet-5", "Sonnet 5"),
    ("claude-fable-5", "Fable 5"),
    ("claude-opus-4-8", "Opus 4.8"),
    ("claude-opus-4-7", "Opus 4.7"),
    ("claude-opus-4-6", "Opus 4.6"),
    ("claude-sonnet-4-6", "Sonnet 4.6"),
    ("claude-haiku-4-5", "Haiku 4.5"),
    ("claude-opus-4-5", "Opus 4.5"),
    ("claude-sonnet-4-5", "Sonnet 4.5"),
)
MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+:/@-]{0,159}")


def model_options(entries):
    models = {}
    for identity, label in entries:
        if isinstance(identity, str) and MODEL_ID.fullmatch(identity) and identity != "default":
            safe_label = label.strip() if isinstance(label, str) and label.isprintable() else ""
            models.setdefault(identity, {"id": identity, "label": safe_label[:160] or identity})
    return list(models.values())[:500]


async def pi_models(protocol):
    await protocol.send({"id": "fpl-model-catalog", "type": "get_available_models"})
    while value := await protocol.read():
        if value.get("id") != "fpl-model-catalog":
            continue
        data = value.get("data")
        models = data.get("models") if isinstance(data, dict) else None
        if value.get("success") is not True or not isinstance(models, list):
            break
        rows = {
            pi_model_id(row["provider"], row["id"]): row
            for row in models
            if isinstance(row, dict)
            and all(isinstance(row.get(key), str) and row[key] for key in ("provider", "id"))
        }
        options = model_options((identity, row.get("name")) for identity, row in rows.items())
        for option in options:
            if rows[option["id"]].get("reasoning") is True:
                option["reasoning_efforts"] = list(PI_REASONING_EFFORTS)
        return options
    raise CliError("Pi 未返回可选模型")


async def harness_models(protocol, root, selected_model=None):
    async def reject_request(value):
        if value.get("method") and "id" in value:
            await protocol.send(
                {
                    "jsonrpc": "2.0",
                    "id": value["id"],
                    "error": {"code": -32601, "message": "Model discovery has no tools"},
                }
            )

    await initialize_acp(protocol, reject_request)
    session = await protocol.rpc(
        "session/new", {"cwd": str(root), "mcpServers": []}, reject_request
    )
    session_id = session.get("sessionId")
    try:
        models = model_options(acp_choices(acp_option(session, "model")).items())
        if selected_model is None:
            return models
        session = await set_acp_option(
            protocol, reject_request, session_id, session, "model", selected_model
        )
        return [
            {"id": value, "label": label}
            for value, label in acp_choices(acp_option(session, "reasoning_effort")).items()
            if OPTION_ID.fullmatch(value)
        ][:100]
    finally:
        if session_id:
            await protocol.rpc("session/close", {"sessionId": session_id}, reject_request)


async def discover_models(agent_id, executable, *, harness_model=None):
    with TemporaryDirectory(prefix="fpl-cli-models-") as directory:
        root = Path(directory)
        if agent_id == "claude-code":
            models = model_options(CLAUDE_PRESETS)
            try:
                code, output = await control_output(executable, ["--help"], environment(), cwd=root)
            except (TimeoutError, OSError, CliError):
                return models
            if code == 0 and re.search(rb"(?<!\w)--effort\b", output):
                for model in models:
                    if efforts := CLAUDE_MODEL_EFFORTS.get(model["id"]):
                        model["reasoning_efforts"] = list(efforts)
            return models
        async with launch(agent_id, executable, root, {}) as (args, env):
            if agent_id == "opencode":
                return await read_opencode_models(executable, env, root)
            process = await spawn_transport(
                *args,
                env=env,
                cwd=root,
                start_new_session=True,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                limit=MAX_BYTES,
            )
            try:
                protocol = JsonLines(process, diagnostics=agent_id == "dsh")
                if agent_id == "pi":
                    return await pi_models(protocol)
                return await harness_models(protocol, root, harness_model)
            finally:
                await close_transport(process)
