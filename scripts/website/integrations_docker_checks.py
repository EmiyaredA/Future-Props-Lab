"""Disposable native MCP and Skill acceptance against the actual independent gateway."""

import io
import json
import os
import secrets
import subprocess
import sys
import time
import zipfile
from urllib.parse import urlsplit

import httpx

from fpl_runtime.integration_intents import digest


class IntegrationsFixture:
    def __init__(self, root, repo, native_base):
        self.root, self.repo, self.native_base = root, repo, native_base
        self.ingress, self.service_token, self.worker = [
            secrets.token_urlsafe(48) for _ in range(3)
        ]
        self.secrets = (self.ingress, self.service_token, self.worker)
        self.process, self.log = None, None
        self.script = root / "native-mcp-fixture.py"
        self.profile = {
            "command": sys.executable,
            "arguments": [str(self.script)],
            "environment_keys": [],
        }

    def prepare(self, material, environment):
        subprocess.run(
            ["git", "check-ignore", "--quiet", str(self.root)], cwd=self.repo, check=True
        )
        (self.root / "integrations").mkdir(mode=0o700)
        material.update(
            {
                "integrations.toml": material["models.toml"],
                "integrations-client.json": json.dumps({"credential": self.service_token}).encode(),
                "integrations-native-ingress": self.ingress.encode(),
                "integrations-workers.json": json.dumps({"fixture-mcp": self.worker}).encode(),
                "integrations-connection.json": json.dumps(
                    {"base_url": self.native_base + "/integrations", "credential": self.worker}
                ).encode(),
                "integrations-profiles.json": json.dumps([self.profile]).encode(),
                self.script.name: b"""from pathlib import Path
from mcp.server import MCPServer
counter=Path(__file__).with_suffix('.count')
counter.write_text(str(int(counter.read_text())+1) if counter.exists() else '1')
server=MCPServer('isolated-native-mcp')
@server.tool()
def safe_fixture() -> str:
    return 'synthetic native result'
server.run(transport='stdio')
""",
            }
        )
        credentials = json.loads(material["service-credentials.json"])
        credentials["integrations"] = self.service_token
        material["service-credentials.json"] = json.dumps(credentials).encode()
        environment.update(
            {
                "FPL_INTEGRATIONS_STATE": str(self.root / "integrations"),
                **{
                    "FPL_INTEGRATIONS_" + name: str(self.root / filename)
                    for name, filename in {
                        "CONFIG": "integrations.toml",
                        "IDENTITY_CLIENT": "integrations-client.json",
                        "NATIVE_INGRESS": "integrations-native-ingress",
                        "WORKERS": "integrations-workers.json",
                    }.items()
                },
            }
        )

    def start(self):
        self.log = (self.root / "native-mcp-worker.log").open("w")
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "fpl_host.mcp_worker",
                "--connection",
                str(self.root / "integrations-connection.json"),
                "--profiles",
                str(self.root / "integrations-profiles.json"),
                "--state-root",
                str(self.root / "native-mcp-state"),
            ],
            cwd=self.repo,
            env={
                "PATH": os.environ.get("PATH", ""),
                "PYTHONPATH": str(self.repo / "backend"),
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONUNBUFFERED": "1",
            },
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )
        checksum = digest(
            {"command": self.profile["command"], "arguments": self.profile["arguments"]}
        )
        with httpx.Client(trust_env=False, timeout=2) as client:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("Native MCP fixture exited before acceptance")
                try:
                    response = client.post(
                        self.native_base + "/integrations/_native/v1/report",
                        headers={"Authorization": "Bearer " + self.worker},
                        json={"profiles": [checksum]},
                    )
                    if response.status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
        raise RuntimeError("Native MCP fixture gateway unavailable")

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.log is not None:
            self.log.close()

    def check(self, client, unsafe, compose, wait, browser_check):
        origin = str(client.base_url).rstrip("/")
        if urlsplit(origin).hostname != "127.0.0.1" or urlsplit(origin).port in {3000, 9000, 9001}:
            raise ValueError("Integrations acceptance requires isolated loopback origin")
        wait(client, "/v1/integrations/mcp")
        created = client.post(
            "/v1/integrations/mcp",
            headers=unsafe,
            json={
                "name": "Isolated native MCP",
                "transport": "stdio",
                "command": self.profile["command"],
                "arguments": self.profile["arguments"],
            },
        )
        assert created.status_code == 201, created.text
        item = created.json()
        validated = client.post("/v1/integrations/mcp/" + item["id"] + "/validate", headers=unsafe)
        assert validated.status_code == 200 and validated.json()["check"]["ok"], validated.text
        assert validated.json()["tools"][0]["name"] == "safe_fixture"
        assert "no-store" in validated.headers["cache-control"]
        assert self.script.with_suffix(".count").read_text() == "1"
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr(
                "SKILL.md",
                "---\nname: isolated-native-skill\ndescription: Persistence fix"
                "ture\n---\n# Native acceptance\n",
            )
            output.writestr("notes/owned.txt", "isolated persistent content")
        uploaded = client.post(
            "/v1/integrations/skills",
            headers=unsafe,
            files={"file": ("native.zip", archive.getvalue(), "application/zip")},
            data={"enabled": "true"},
        )
        assert uploaded.status_code == 201, uploaded.text
        skill = uploaded.json()
        compose("up", "--detach", "--no-deps", "--force-recreate", "integrations")
        saved = wait(client, "/v1/integrations/mcp/" + item["id"]).json()
        assert saved["status"] == "healthy" and saved["server_name"] == "isolated-native-mcp"
        markdown = client.get("/v1/integrations/skills/" + skill["id"] + "/versions/v1/skill-md")
        assert markdown.status_code == 200 and "Native acceptance" in markdown.json()["content"], (
            markdown.text
        )
        archive_response = client.get(
            "/v1/integrations/skills/" + skill["id"] + "/versions/v1/content"
        )
        assert archive_response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(archive_response.content)) as saved_archive:
            assert saved_archive.read("notes/owned.txt") == b"isolated persistent content"
        assert self.script.with_suffix(".count").read_text() == "1"
        diagnostics = compose(
            "exec",
            "--no-TTY",
            "integrations",
            "python",
            "-c",
            "import sqlite3;c=sqlite3.connect('file:/state/service.db?mode=ro',uri=True);"
            "assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';"
            "assert c.execute('PRAGMA foreign_key_check').fetchall()==[];"
            'assert c.execute("SELECT count(*) FROM integration_native_mc'
            "p_jobs WHERE status='completed'\").fetchone()[0]==1;"
            'assert c.execute("SELECT count(*) FROM integration_validatio'
            "n_attempts WHERE status='completed' AND released=1\").fetchon"
            "e()[0]==1;"
            'tables={r[0] for r in c.execute("SELECT name FROM sqlite_mas'
            "ter WHERE type='table'\")};"
            "assert not {'users','visual_assets','model_providers'}&table"
            "s;print('owned Integrations intact')",
        )
        assert "owned Integrations intact" in diagnostics.stdout
        diagnostics = compose(
            "exec",
            "--no-TTY",
            "models",
            "python",
            "-c",
            "import sqlite3;c=sqlite3.connect('file:/state/service.db?mode=ro',uri=True);"
            'assert c.execute("SELECT count(*) FROM model_integration_cap'
            "acity WHERE outcome='completed'\").fetchone()[0]>=1;"
            'assert c.execute("SELECT count(*) FROM runtime_admissions WH'
            "ERE task_kind='integration-validation' AND released_at IS NU"
            'LL").fetchone()[0]==0;'
            "print('shared capacity settled')",
        )
        assert "shared capacity settled" in diagnostics.stdout
        if browser_check:
            cookies = [
                {"name": cookie.name, "value": cookie.value, "url": origin + "/"}
                for cookie in client.cookies.jar
            ]
            result = subprocess.run(
                ["node", str(self.repo / "web/scripts/integrations-service-browser-smoke.mjs")],
                cwd=self.repo,
                input=json.dumps(
                    {
                        "origin": origin + "/",
                        "cookies": cookies,
                        "output": str(self.root / "integrations-browser"),
                        "repo": str(self.repo),
                    }
                ),
                capture_output=True,
                text=True,
                timeout=180,
            )
            if result.returncode:
                raise RuntimeError(
                    "Integrations browser acceptance failed: " + result.stdout + result.stderr
                )
        return (
            "Integrations native stdio discovery executes once; shared qu"
            "ota settles and independent restart preserves catalogs and S"
            "kill bytes"
        )
