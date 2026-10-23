"""Protocol selection and request defaults for text provider adapters."""

from typing import Any

OPENAI_CHAT_KINDS = frozenset({"openai", "deepseek"})
TEXT_PROVIDER_KINDS = OPENAI_CHAT_KINDS | {"anthropic"}
DEEPSEEK_BASE_URL = "https://api.deepseek.com"


def chat_base_url(kind: str, base_url: str) -> str:
    if base_url:
        return base_url
    return DEEPSEEK_BASE_URL if kind == "deepseek" else "https://api.openai.com/v1"


def chat_request_options(kind: str) -> dict[str, Any]:
    # DeepSeek enables thinking by default. Every call, including diagnostics and
    # tool follow-ups, must use the mode supported by our public text contract.
    return {"thinking": {"type": "disabled"}} if kind == "deepseek" else {}
