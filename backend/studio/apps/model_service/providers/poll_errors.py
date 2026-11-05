"""Normalize transient provider polling failures at the transport boundary."""

import httpx


def is_transient_poll_error(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {
        408,
        429,
        500,
        502,
        503,
        504,
    }
