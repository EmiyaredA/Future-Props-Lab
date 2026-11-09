"""Project only observed token counts into a per-turn usage snapshot."""

from collections import Counter


def record(value):
    return value if isinstance(value, dict) else {}


def token_counts(source, **fields):
    source = record(source)
    return {
        name: value
        for name, key in fields.items()
        if type(value := source.get(key)) is int
        and 0 <= value <= 2**53 - 1
        and (name != "context_limit" or value > 0)
    }


def codex_usage(params):
    usage = record(params.get("tokenUsage", params.get("token_usage")))
    return {
        **token_counts(
            usage.get("total"),
            input_tokens="inputTokens",
            output_tokens="outputTokens",
            cached_input_tokens="cachedInputTokens",
            reasoning_tokens="reasoningOutputTokens",
            total_tokens="totalTokens",
        ),
        **token_counts(usage.get("last"), context_used="totalTokens"),
        **token_counts(usage, context_limit="modelContextWindow"),
    }


def claude_usage(result):
    return token_counts(
        result.get("usage"),
        input_tokens="input_tokens",
        output_tokens="output_tokens",
        cached_input_tokens="cache_read_input_tokens",
        cache_write_tokens="cache_creation_input_tokens",
    )


def opencode_usage(part):
    tokens = record(part.get("tokens"))
    return {
        **token_counts(
            tokens,
            input_tokens="input",
            output_tokens="output",
            reasoning_tokens="reasoning",
            total_tokens="total",
        ),
        **token_counts(tokens.get("cache"), cached_input_tokens="read", cache_write_tokens="write"),
    }


def pi_usage(message):
    return token_counts(
        message.get("usage"),
        input_tokens="input",
        output_tokens="output",
        cached_input_tokens="cacheRead",
        cache_write_tokens="cacheWrite",
        total_tokens="totalTokens",
    )


class UsageAccumulator:
    """Deduplicate repeated observations of a step without combining cumulative snapshots."""

    def __init__(self, emit):
        self.emit = emit
        self.totals = Counter()
        self.parts = set()

    async def add(self, identity, counts):
        if not counts:
            return
        if isinstance(identity, str) and identity:
            if identity in self.parts:
                return
            self.parts.add(identity)
        self.totals.update(counts)
        await self.emit("run_usage", dict(self.totals))
