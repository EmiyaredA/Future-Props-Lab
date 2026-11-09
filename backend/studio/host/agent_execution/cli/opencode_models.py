"""OpenCode's bounded CLI catalog. Only display metadata leaves the host."""

import json
import re

from .isolation import control_output
from .transport import CliError

MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+:/@-]{0,159}")
OPTION_ID = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]{0,79}")


def parse_opencode_models(output):
    """The CLI prints a provider/model line, followed by one JSON object in verbose mode."""
    source = output.decode()
    decoder = json.JSONDecoder()
    models = {}
    while source := source.lstrip():
        identity, _, source = source.partition("\n")
        identity = identity.strip()
        if "/" not in identity or not MODEL_ID.fullmatch(identity):
            continue
        metadata = {}
        source = source.lstrip()
        if source.startswith("{"):
            metadata, end = decoder.raw_decode(source)
            source = source[end:]
        variants = metadata.get("variants", {})
        if isinstance(variants, dict):
            variants = [
                {"id": key, "name": key}
                for key, value in variants.items()
                if not isinstance(value, dict) or value.get("disabled") is not True
            ]
        if not isinstance(variants, list):
            variants = []
        options = {}
        for item in variants:
            if not isinstance(item, dict) or item.get("disabled") is True:
                continue
            key = item.get("id")
            if not isinstance(key, str) or not OPTION_ID.fullmatch(key):
                continue
            label = item.get("name")
            options.setdefault(
                key,
                {
                    "id": key,
                    "label": label[:160] if isinstance(label, str) and label.isprintable() else key,
                },
            )
        models.setdefault(
            identity,
            {
                "id": identity,
                "label": identity,
                "variants": list(options.values())[:100],
            },
        )
    return list(models.values())[:500]


async def read_opencode_models(executable, env, root, *, require_metadata=False, provider=None):
    args = ["--pure", "models", *([provider] if provider else [])]
    try:
        code, output = await control_output(executable, [*args, "--verbose"], env, cwd=root)
        if code:
            raise CliError("OpenCode 模型变体目录读取失败")
        return parse_opencode_models(output)
    except (OSError, ValueError, TimeoutError):
        if require_metadata:
            raise CliError("OpenCode 模型变体目录不可用，请重新选择") from None
    code, output = await control_output(executable, args, env, cwd=root)
    if code:
        raise CliError("OpenCode 模型目录读取失败")
    return parse_opencode_models(output)
