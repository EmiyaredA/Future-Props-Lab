"""The daily launcher shares existing configuration; automated tests stay isolated."""

import hashlib
import json
import signal
import socket
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from scripts.website import application, development, frontend, service


def test_daily_environment_reuses_toml_without_copying_data_or_replacing_keys(
    tmp_path, monkeypatch
):
    config = tmp_path / "backend/config.toml"
    config.parent.mkdir()
    config.write_text('[security]\nsecrets_key = "existing-key"\n')
    monkeypatch.setenv("FPL_CONFIG_FILE", "/other/config.toml")
    monkeypatch.setenv("FPL_DATABASE_PATH", "/other/future-props.db")
    monkeypatch.setenv("FPL_SECRETS_KEY", "other-key")
    monkeypatch.setenv("FPL_E2E_WEB_PORT", "19119")
    monkeypatch.setenv("VITE_API_BASE", "https://other.invalid")
    before = config.read_bytes()
    values = development.environment(tmp_path)
    assert values["FPL_CONFIG_FILE"] == str(config)
    assert "FPL_DATABASE_PATH" not in values
    assert "FPL_SECRETS_KEY" not in values
    assert values["FPL_E2E_WEB_PORT"] == "3000"
    assert values["FPL_E2E_API_PORT"] == "9001"
    assert values["VITE_API_BASE"] == ""
    assert config.read_bytes() == before
    assert not (tmp_path / ".local/dev-runtime").exists()


def test_frontend_starts_only_after_backend_readiness_and_failure_stops_both(tmp_path, monkeypatch):
    events = []
    backend = SimpleNamespace(poll=lambda: None)
    frontend = SimpleNamespace(poll=lambda: 1)
    children = iter([backend, frontend])

    def spawn(command, **kwargs):
        events.append(command)
        assert kwargs["start_new_session"] is True
        return next(children)

    monkeypatch.setattr(development, "check_ports", lambda: None)
    monkeypatch.setattr(development.subprocess, "Popen", spawn)
    monkeypatch.setattr(development, "wait_ready", lambda child: events.append(("ready", child)))
    stopped = Mock()
    monkeypatch.setattr(development, "stop_children", stopped)
    with pytest.raises(RuntimeError, match="之一已退出"):
        development.run_pair(tmp_path)
    assert events[0][-1] == "--reload"
    assert events[1] == ("ready", backend)
    assert events[2][-1] == "--strictPort"
    stopped.assert_called_once_with([backend, frontend])


def test_backend_readiness_failure_never_starts_frontend(tmp_path, monkeypatch):
    monkeypatch.setattr(development, "check_ports", lambda: None)
    child = SimpleNamespace(poll=lambda: 2)
    spawn = Mock(return_value=child)
    stopped = Mock()
    monkeypatch.setattr(development.subprocess, "Popen", spawn)
    monkeypatch.setattr(development, "stop_children", stopped)
    with pytest.raises(RuntimeError, match="后端启动失败"):
        development.run_pair(tmp_path)
    assert spawn.call_count == 1
    stopped.assert_called_once_with([child])


def test_occupied_port_fails_instead_of_silently_switching(monkeypatch):
    sock = Mock()
    sock.__enter__ = Mock(return_value=sock)
    sock.__exit__ = Mock(return_value=False)
    sock.bind.side_effect = OSError("busy")
    monkeypatch.setattr(socket, "socket", Mock(return_value=sock))
    with pytest.raises(RuntimeError, match="3000.*不会另选端口"):
        development.check_ports()


def test_failed_frontend_build_keeps_serving_last_verified_release(tmp_path, monkeypatch):
    html = b"<html>good</html>"

    def build(_command, *, env, **_kwargs):
        directory = Path(env["FPL_WEB_DIST_DIR"])
        directory.mkdir()
        files = [
            {"path": "index.html", "bytes": len(html), "sha256": hashlib.sha256(html).hexdigest()}
        ]
        build_id = hashlib.sha256(json.dumps(files, separators=(",", ":")).encode()).hexdigest()
        metadata = json.dumps({"build_id": build_id}).encode()
        files.append(
            {
                "path": "build.json",
                "bytes": len(metadata),
                "sha256": hashlib.sha256(metadata).hexdigest(),
            }
        )
        (directory / "index.html").write_bytes(html)
        (directory / "build.json").write_bytes(metadata)
        (directory / "manifest.json").write_text(json.dumps({"build_id": build_id, "files": files}))
        return subprocess.CompletedProcess([], 0)

    monkeypatch.setattr(frontend.subprocess, "run", build)
    frontend.rebuild(tmp_path)
    current = tmp_path / frontend.CURRENT
    first = current.resolve()
    html = b"<html>new</html>"
    frontend.rebuild(tmp_path)
    active = current.resolve()
    assert first != active
    assert (current.parent / "retired" / first.name).is_file()
    assert not (current.parent / "retired" / active.name).exists()
    monkeypatch.setattr(
        frontend.subprocess, "run", Mock(side_effect=subprocess.CalledProcessError(1, "npm"))
    )
    with pytest.raises(subprocess.CalledProcessError):
        frontend.rebuild(tmp_path)
    assert current.resolve() == active
    assert (current / "index.html").read_bytes() == b"<html>new</html>"


def test_shutdown_drains_parents_then_cleans_remaining_process_groups(monkeypatch):
    child = Mock(pid=123456)
    child.poll.return_value = None
    child.wait.side_effect = [subprocess.TimeoutExpired("backend", 30), 0]
    kill = Mock()
    monkeypatch.setattr(development.os, "killpg", kill)
    development.stop_children([child])
    child.terminate.assert_called_once()
    kill.assert_called_once_with(child.pid, signal.SIGKILL)


def test_each_worker_checks_schema_before_importing_database_runtime(monkeypatch):
    from db import migrations

    def reject(_path):
        raise RuntimeError("unapproved migration")

    monkeypatch.setattr(migrations, "check_migrations", reject)
    with pytest.raises(RuntimeError, match="unapproved migration"):
        application.create_app()


def test_background_service_and_npm_aliases_use_the_same_pair(tmp_path):
    python = tmp_path / ".venv/bin/python"
    python.parent.mkdir(parents=True)
    python.touch()
    args = service.definition(tmp_path)["ProgramArguments"]
    assert args == [str(python), str(tmp_path / "scripts/website/development.py")]
    package = json.loads((development.ROOT / "package.json").read_text())
    assert package["scripts"]["start"] == "uv run python scripts/website/development.py"
    assert all(
        package["scripts"][name] == "npm start"
        for name in ["dev", "dev:web", "dev:backend", "start:backend"]
    )
