"""Exercise migration failure recovery without touching the real launchd domain."""

import plistlib
import subprocess

import pytest
from scripts.website import awake


def setup_migration(tmp_path, monkeypatch):
    root = tmp_path / "Future-Props-Lab"
    root.mkdir()
    runtime = root / ".runtime/host-awake"
    runtime.mkdir(parents=True)
    target = tmp_path / f"{awake.LABEL}.plist"
    previous = awake.definition(root)
    previous["WorkingDirectory"] = str(root.parent / "remote-control")
    for key in ("StandardOutPath", "StandardErrorPath"):
        previous[key] = str(root.parent / "remote-control/.local/mac-host/logs" / key)
    target.write_bytes(plistlib.dumps(previous))
    target.chmod(0o600)
    state = {"loaded": previous, "fail": False}

    def fake_launchctl(*args, check=True):
        code, output = 0, ""
        if args[0] == "print":
            value = state["loaded"]
            if value is None:
                code = 113
            else:
                output = (
                    "\tstate = running\n"
                    + "".join(
                        f"\t{key} = {value[field]}\n"
                        for key, field in (
                            ("working directory", "WorkingDirectory"),
                            ("stdout path", "StandardOutPath"),
                            ("stderr path", "StandardErrorPath"),
                        )
                    )
                    + "\tprogram = /usr/bin/caffeinate\n"
                    + "\targuments = {\n\t\t/usr/bin/caffeinate\n\t\t-s\n\t}\n"
                )
        elif args[0] == "bootout":
            state["loaded"] = None
        elif args[0] == "bootstrap":
            value = plistlib.loads(target.read_bytes())
            if state["fail"] and value == awake.definition(root):
                code = 5
            else:
                state["loaded"] = value
        result = subprocess.CompletedProcess(
            args, code, output, "simulated failure" if code else ""
        )
        if check:
            result.check_returncode()
        return result

    monkeypatch.setattr(awake, "launchctl", fake_launchctl)
    monkeypatch.setattr(awake.time, "sleep", lambda _: None)
    monkeypatch.setattr(awake.subprocess, "run", lambda *_, **__: None)
    return root, target, previous, state


def test_migrates_same_label_and_keeps_recovery_copy(tmp_path, monkeypatch):
    root, target, previous, state = setup_migration(tmp_path, monkeypatch)
    awake.install(root, target, "gui/501")
    assert state["loaded"] == awake.definition(root)
    assert plistlib.loads(target.read_bytes()) == awake.definition(root)
    assert target.stat().st_mode & 0o777 == 0o600
    backups = list((root / ".runtime/host-awake/rollback").glob(f"*/{target.name}"))
    assert len(backups) == 1
    assert plistlib.loads(backups[0].read_bytes()) == previous
    awake.install(root, target, "gui/501")
    assert len(list((root / ".runtime/host-awake/rollback").iterdir())) == 1


def test_failed_load_restores_original_definition_and_running_task(tmp_path, monkeypatch):
    root, target, previous, state = setup_migration(tmp_path, monkeypatch)
    original = target.read_bytes()
    state["fail"] = True
    with pytest.raises(RuntimeError, match="加载失败"):
        awake.install(root, target, "gui/501")
    assert target.read_bytes() == original
    assert state["loaded"] == previous
    assert not (root / ".runtime/host-awake/launchagent.plist").exists()


def test_other_project_definition_is_not_overwritten(tmp_path, monkeypatch):
    root, target, previous, state = setup_migration(tmp_path, monkeypatch)
    previous["WorkingDirectory"] = "/another/project"
    target.write_bytes(plistlib.dumps(previous))
    original = target.read_bytes()
    with pytest.raises(ValueError, match="拒绝覆盖"):
        awake.install(root, target, "gui/501")
    assert target.read_bytes() == original
    assert state["loaded"] is previous


def test_loaded_task_without_recovery_definition_is_not_stopped(tmp_path, monkeypatch):
    root, target, previous, state = setup_migration(tmp_path, monkeypatch)
    target.unlink()
    with pytest.raises(ValueError, match="缺少原启动定义"):
        awake.install(root, target, "gui/501")
    assert state["loaded"] is previous
