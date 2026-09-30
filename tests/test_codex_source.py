import tomllib
from dataclasses import replace

import httpx
import pytest

from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.tool_navigation.codex_source import (
    CodexSourceConflict,
    CodexSourceError,
    CodexSourceRestore,
    CodexSourceUpdate,
    read_codex_source,
    restore_codex_source,
    update_codex_source,
)


def test_codex_source_switch_and_restore_preserves_original_config(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    original = (
        'model = "gpt-existing"\n'
        'model_provider = "openai"\n'
        'approval_policy = "on-request"\n'
        '\n[mcp_servers.example]\ncommand = "example"\n'
        '\n[[profiles]]\nname = "keep-me"\n'
    )
    config = tmp_path / "config.toml"
    config.write_text(original, encoding="utf-8")
    before = read_codex_source()

    custom = update_codex_source(
        CodexSourceUpdate(
            expected_revision=before.revision,
            source="custom",
            model="example/model-1",
            base_url="https://example.com/v1/",
            env_key="EXAMPLE_API_KEY",
        )
    )
    parsed = tomllib.loads(config.read_text(encoding="utf-8"))
    assert custom.managed
    assert parsed["model"] == "example/model-1"
    assert parsed["model_providers"]["fpl_custom"]["base_url"] == "https://example.com/v1"
    assert parsed["model_providers"]["fpl_custom"]["env_key"] == "EXAMPLE_API_KEY"
    assert parsed["mcp_servers"]["example"]["command"] == "example"
    assert parsed["profiles"][0]["name"] == "keep-me"
    assert "EXAMPLE_API_KEY" in config.read_text(encoding="utf-8")
    assert (config.stat().st_mode & 0o777) == 0o600
    assert (tmp_path / "config.toml.fpl-original").read_text(encoding="utf-8") == original

    official = update_codex_source(
        CodexSourceUpdate(expected_revision=custom.revision, source="openai")
    )
    assert official.provider == "openai"
    assert "fpl_custom" not in config.read_text(encoding="utf-8")

    restored = restore_codex_source(CodexSourceRestore(expected_revision=official.revision))
    assert restored.provider == "openai"
    assert config.read_text(encoding="utf-8") == original
    assert not (tmp_path / "config.toml.fpl-original").exists()


def test_codex_source_rejects_stale_revision_and_invalid_url(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    original = read_codex_source()
    config = tmp_path / "config.toml"
    config.write_text('model = "another"\n', encoding="utf-8")

    with pytest.raises(CodexSourceConflict):
        update_codex_source(CodexSourceUpdate(expected_revision=original.revision, source="openai"))
    current = read_codex_source()
    with pytest.raises(CodexSourceError, match="API 基础地址"):
        update_codex_source(
            CodexSourceUpdate(
                expected_revision=current.revision,
                source="custom",
                model="test-model",
                base_url="https://user:secret@example.com/v1",
            )
        )
    assert config.read_text(encoding="utf-8") == 'model = "another"\n'
    assert not (tmp_path / "config.toml.fpl-original").exists()


def test_codex_source_does_not_follow_config_symlink(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    target = tmp_path / "other.toml"
    target.write_text('model = "original"\n', encoding="utf-8")
    (tmp_path / "config.toml").symlink_to(target)
    with pytest.raises(CodexSourceError, match="符号链接"):
        read_codex_source()


def test_codex_source_rejects_multiline_strings_before_editing(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    config = tmp_path / "config.toml"
    original = 'instructions = """\nmodel = "example"\n"""\n'
    config.write_text(original, encoding="utf-8")
    with pytest.raises(CodexSourceError, match="多行 TOML"):
        update_codex_source(
            CodexSourceUpdate(expected_revision=read_codex_source().revision, source="openai")
        )
    assert config.read_text(encoding="utf-8") == original


def test_codex_source_does_not_expose_unmanaged_endpoint_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    (tmp_path / "config.toml").write_text(
        'model_provider = "other"\n[model_providers.other]\n'
        'base_url = "https://user:secret@example.com/v1"\n',
        encoding="utf-8",
    )
    state = read_codex_source()
    assert state.provider == "other"
    assert state.base_url == ""


@pytest.mark.asyncio
async def test_codex_source_api_only_runs_in_desktop(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/tool-navigation/codex-source")).status_code == 404
        monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)
        current = await client.get("/v1/tool-navigation/codex-source")
        assert current.status_code == 200
        assert current.json()["revision"] == "missing"
        response = await client.put(
            "/v1/tool-navigation/codex-source",
            json={
                "expected_revision": "missing",
                "source": "custom",
                "model": "local-model",
                "base_url": "http://127.0.0.1:1234/v1",
                "env_key": "",
            },
        )
        assert response.status_code == 200
        assert response.json()["provider"] == "fpl_custom"
        assert (
            await client.put(
                "/v1/tool-navigation/codex-source",
                json={"expected_revision": "missing", "source": "openai"},
            )
        ).status_code == 409
        original_auth = app.dependency_overrides[require_studio_auth]

        async def api_key_principal(session: SessionDep):
            return replace(await original_auth(session), auth_kind="management_api_key")

        app.dependency_overrides[require_studio_auth] = api_key_principal
        try:
            assert (await client.get("/v1/tool-navigation/codex-source")).status_code == 403
        finally:
            app.dependency_overrides[require_studio_auth] = original_auth
