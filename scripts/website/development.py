"""Start an isolated development backend without reading production configuration."""

import json
import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[2]


def environment(root=ROOT):
    runtime = root / ".local/dev-runtime"
    config = runtime / "backend/config.toml"
    config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not config.exists():
        with config.open("x") as stream:
            stream.write(
                "[storage]\ndatabase_path = "
                + json.dumps(str(runtime / "future-props.db"))
                + '\n[security]\nsecrets_key = "'
                + Fernet.generate_key().decode()
                + '"\n[http]\ncors_origins = ["http://127.0.0.1:3000"]\n'
            )
        config.chmod(0o600)
    values = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("FPL_") and name != "CORS_ORIGINS"
    }
    values["FPL_CONFIG_FILE"] = str(config)
    values["FPL_DATABASE_PATH"] = str(runtime / "future-props.db")
    return values


if __name__ == "__main__":
    os.chdir(ROOT)
    os.execve(
        sys.executable,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--app-dir",
            "backend",
            "--reload",
            "--host",
            "127.0.0.1",
            "--port",
            "9001",
            "--timeout-graceful-shutdown",
            "10",
        ],
        environment(),
    )
