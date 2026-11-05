"""Pure publication filtering: never publish credentials or account-specific paths."""

from urllib.parse import urlsplit

from studio.contracts.creative_workshop.errors import CreativeError
from studio.contracts.integrations.catalog import ToolApiCreateIn
from studio.runtime.http.outbound_urls import normalize_integration_http_url

KIND_VALUES = {"tool_api", "mcp", "skill", "bundle"}
SENSITIVE_KEYS = {
    "authorization",
    "api_key",
    "apikey",
    "access_key",
    "accesskey",
    "token",
    "secret",
    "password",
    "bearer",
    "credential",
    "private_key",
}


def check_public_structure(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if any(part in str(key).lower() for part in SENSITIVE_KEYS):
                raise CreativeError("公开配置不能包含凭据字段")
            check_public_structure(child)
    elif isinstance(value, list):
        for child in value:
            check_public_structure(child)
    elif isinstance(value, str) and ("Bearer " in value or "-----BEGIN " in value):
        raise CreativeError("公开配置疑似包含凭据")


def _http_url_without_private_query(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise CreativeError("公开 URL 不能包含账号、查询参数或片段")
    return url


def public_manifest(
    *, kind: str, title: str, summary: str, manifest: dict, has_skill: bool
) -> dict:
    draft = dict(manifest or {})
    if kind == "tool_api":
        allowed = {
            key: draft[key]
            for key in (
                "method",
                "url",
                "auth_kind",
                "auth_header_name",
                "parameters_schema",
                "query_template",
                "body_template",
            )
            if key in draft
        }
        allowed.setdefault("method", "GET")
        allowed.setdefault("auth_kind", "none")
        allowed.setdefault("parameters_schema", {"type": "object", "properties": {}})
        allowed.setdefault("query_template", {})
        check_public_structure(allowed)
        try:
            checked = ToolApiCreateIn.model_validate(
                {**allowed, "name": title, "description": summary, "enabled": False}
            )
        except ValueError as exc:
            raise CreativeError(f"工具 API 配置无效：{exc}") from exc
        allowed["url"] = _http_url_without_private_query(checked.url)
        return allowed
    if kind == "mcp":
        transport = draft.get("transport")
        if transport == "streamable_http":
            url = draft.get("url", "")
            if not isinstance(url, str) or not url:
                raise CreativeError("HTTP MCP 需要 URL")
            try:
                checked_url = normalize_integration_http_url(url)
            except ValueError as exc:
                raise CreativeError(str(exc)) from exc
            result = {"transport": transport, "url": _http_url_without_private_query(checked_url)}
        elif transport == "stdio":
            hint = str(draft.get("command_hint", "")).strip()
            if not hint or len(hint) > 200:
                raise CreativeError("stdio MCP 需要简短的本机安装命令提示")
            if "/" in hint or "\\" in hint:
                raise CreativeError("stdio 命令提示不能包含本机路径")
            result = {"transport": transport, "command_hint": hint}
        else:
            raise CreativeError("MCP 连接类型无效")
        check_public_structure(result)
        return result
    if kind == "skill":
        if not has_skill:
            raise CreativeError("发布 Skill 前须上传 ZIP 文件")
        return {
            key: draft[key]
            for key in ("name", "description", "content_sha256", "file_count", "expanded_bytes")
            if key in draft
        }
    return {}
