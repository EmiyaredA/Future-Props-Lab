"""Run one locked website process. Configuration precedes all database imports."""

import argparse
import contextlib
import fcntl
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))


from scripts.website.application import authenticate_browser  # noqa: E402, F401


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--config", type=Path, default=ROOT / "backend/config.toml")
    args = parser.parse_args()
    # A production service never inherits a development database or secret override.
    for name in list(os.environ):
        if name.startswith("FPL_") or name == "CORS_ORIGINS":
            os.environ.pop(name)
    os.environ["FPL_CONFIG_FILE"] = str(args.config.resolve())
    if args.reload:
        os.environ["FPL_WEBSITE_PORT"] = "9001"
        os.environ["CORS_ORIGINS"] = "http://127.0.0.1:3000,http://127.0.0.1:9001"
    from app.runtime.config import get_settings

    settings = get_settings()
    web_root = Path(settings.fpl_website_web_root).expanduser()
    if not web_root.is_absolute():
        web_root = ROOT / web_root
    if not (web_root / "index.html").is_file():
        raise SystemExit("网站构建缺失，请运行 npm run build:studio")
    if not settings.database_path.is_file():
        raise SystemExit("网站数据库不存在；请先完成正式迁移或显式初始化隔离环境")
    settings.runtime_path.mkdir(mode=0o700, parents=True, exist_ok=True)
    with contextlib.ExitStack() as stack:
        lock = stack.enter_context((settings.runtime_path / "website.lock").open("a"))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("已有网站实例使用此数据目录") from None
        os.chmod(lock.name, 0o600)
        if settings.fpl_website_legacy_data_root:
            original = Path(settings.fpl_website_legacy_data_root).expanduser()
            if original.is_dir():
                legacy_lock = stack.enter_context((original / "backend.lock").open("a"))
                try:
                    fcntl.flock(legacy_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SystemExit("旧桌面实例仍在运行，请先正常退出") from None
        from db.migrations import check_migrations

        # Compatibility is checked only after both data locks are held.
        check_migrations(settings.database_path)
        if args.check:
            print("Website configuration, build and database migrations are ready")
            return
        serve(settings, reload=args.reload)


def serve(settings, *, reload=False):
    import uvicorn

    uvicorn.run(
        "scripts.website.application:create_app",
        factory=True,
        reload=reload,
        reload_dirs=[str(ROOT / "backend"), str(ROOT / "scripts/website")] if reload else None,
        host="127.0.0.1",
        port=settings.fpl_website_port,
        workers=1,
        proxy_headers=False,
        access_log=False,
        timeout_graceful_shutdown=10,
    )


if __name__ == "__main__":
    main()
