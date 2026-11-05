from __future__ import annotations

from studio.runtime.tasks.reactive_tools.types import ContextFragment


class ContextCompiler:
    def __init__(self, max_characters: int) -> None:
        self.max_characters = max_characters

    def compile(self, fragments: list[ContextFragment]) -> tuple[str, dict[str, int]]:
        remaining = self.max_characters
        included: list[str] = []
        omitted = 0
        for fragment in sorted(fragments, key=lambda item: item.priority, reverse=True):
            content = fragment.content.strip()
            if not content:
                continue
            local_limit = fragment.character_budget or len(content)
            candidate = content[:local_limit]
            if remaining <= 0:
                omitted += 1
                continue
            if len(candidate) > remaining:
                candidate = candidate[:remaining]
                omitted += 1
            included.append(f"[{fragment.source}]\n{candidate}")
            remaining -= len(candidate)
        if omitted:
            included.append(f"[context_truncated]\n另有 {omitted} 个上下文片段因长度限制被截断。")
        return "\n\n".join(included), {
            "included": len(included) - (1 if omitted else 0),
            "omitted": omitted,
            "characters": self.max_characters - remaining,
        }
