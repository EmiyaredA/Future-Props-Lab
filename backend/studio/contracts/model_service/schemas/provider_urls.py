"""Pure provider configuration normalization shared with adapter construction."""

from urllib.parse import urlsplit, urlunsplit

from studio.runtime.http.outbound_urls import require_safe_provider_base_url


def zealman_root_url(base_url: str) -> str:
    parsed = urlsplit(require_safe_provider_base_url(base_url))
    if not parsed.hostname:
        raise ValueError("ZEALMAN 必须配置服务地址")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
