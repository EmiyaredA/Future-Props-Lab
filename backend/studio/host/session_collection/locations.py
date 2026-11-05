"""Native source location validation without FPL ORM, credentials or CLI execution."""

from pathlib import Path
from urllib.parse import urlsplit


def validate_location(*, agent_id, root="", endpoint=""):
    if endpoint:
        try:
            url = urlsplit(endpoint)
            port = url.port
        except ValueError as exc:
            raise ValueError("本机实例地址无效") from exc
        if (
            agent_id != "opencode"
            or url.scheme != "http"
            or url.hostname not in {"127.0.0.1", "::1"}
            or url.username
            or url.password
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
            or not port
            or any(character.isspace() for character in endpoint)
        ):
            raise ValueError("仅允许明确选择的本机 OpenCode HTTP 实例（不含凭据）")
        return "", endpoint.rstrip("/")
    try:
        path = Path(root).expanduser()
    except (ValueError, RuntimeError) as exc:
        raise ValueError("来源目录无效") from exc
    if not path.is_absolute() or path.is_symlink():
        raise ValueError("请选择绝对路径的真实会话目录")
    try:
        canonical = path.resolve(strict=True)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ValueError("来源目录不可用") from exc
    if not canonical.is_dir() or canonical in {Path.home(), Path(canonical.anchor)}:
        raise ValueError("请选择具体的会话目录，不能扫描整个用户目录或磁盘")
    return str(canonical), ""
