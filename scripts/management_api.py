import os


def management_api_key() -> str:
    """Read a short-lived Management API key from the process environment only."""
    value = os.environ.get("FPL_MANAGEMENT_API_KEY", "").strip()
    if not value.startswith("fpm_"):
        raise RuntimeError("请通过进程环境变量 FPL_MANAGEMENT_API_KEY 提供短期 Management API Key")
    return value
