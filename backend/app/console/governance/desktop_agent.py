"""Ephemeral pairing and an explicit business-operation allowlist.

Node output queries, uploads and final-version selection are individually registered
in the manifest; version deletion and unknown future routes remain default-deny.
Persistent keys use the existing governance use case.
"""

import asyncio
import hashlib
import json
import re
import secrets
import time
from pathlib import Path

from app.capabilities.identity.errors import AccountError
from app.console.governance.service import create_api_key

MANIFEST = json.loads(Path(__file__).with_name("desktop_agent_operations.json").read_text())
PATTERNS = [
    (method, re.compile("^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(path)) + "$"))
    for method, path in (key.split(" ", 1) for key in MANIFEST["operations"])
]


def allows_agent(method: str, path: str) -> bool:
    controls = {
        ("POST", "/v1/desktop/agent/pairings"),
        ("GET", "/v1/desktop/agent/capabilities"),
        ("POST", "/v1/desktop/ui/open"),
    }
    return bool(
        (method, path) in controls
        or (method == "POST" and re.fullmatch(r"/v1/desktop/agent/pairings/[\w-]+/claim", path))
        or (method == "GET" and re.fullmatch(r"/v1/desktop/ui/requests/[\w-]+", path))
        or any(method == verb and pattern.fullmatch(path) for verb, pattern in PATTERNS)
    )


class AgentError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


class DesktopAgent:
    def __init__(self):
        self.pairings = {}
        self.lock = asyncio.Lock()
        self.attempts = []
        self.ui_requests = {}
        self.viewers = {}
        self.changes = {}
        self.integration_changes = {}
        self.content_changes = {}

    def prune(self):
        now = time.monotonic()
        self.pairings = {k: v for k, v in self.pairings.items() if v["expires"] > now}
        self.ui_requests = {k: v for k, v in self.ui_requests.items() if v["expires"] > now}
        self.viewers = {k: v for k, v in self.viewers.items() if v > now - 30}

    def begin(self, name, scope):
        self.prune()
        now = time.monotonic()
        self.attempts = [t for t in self.attempts if t > now - 60]
        if len(self.attempts) >= 5 or len(self.pairings) >= 20:
            raise AgentError(429, "pairing_rate_limited")
        self.attempts.append(now)
        token = secrets.token_urlsafe(32)
        row = dict(
            id=secrets.token_hex(16),
            code=f"{secrets.randbelow(1000000):06d}",
            name=name.strip(),
            scope=scope,
            status="pending",
            expires=now + 300,
            claim_hash=hashlib.sha256(token.encode()).digest(),
        )
        self.pairings[row["id"]] = row
        return {**row, "claim_token": token}

    def get_pair(self, pair_id):
        self.prune()
        row = self.pairings.get(pair_id)
        if row is None:
            raise AgentError(410, "pairing_expired")
        return row

    async def decide(self, pair_id, body, session, principal, ip):
        async with self.lock:
            row = self.get_pair(pair_id)
            if row["status"] != "pending":
                raise AgentError(409, "pairing_already_decided")
            if not secrets.compare_digest(row["code"], body.code):
                raise AgentError(403, "pairing_code_mismatch")
            if not body.approve:
                row["status"] = "denied"
                return row
            try:
                key, secret = await create_api_key(
                    session,
                    principal,
                    name=f"Agent: {row['name']}",
                    scopes=[row["scope"]],
                    expires_in_days=90,
                    client_ip=ip,
                )
            except AccountError:
                await session.rollback()
                raise
            row.update(
                status="approved",
                secret=secret,
                key_id=key.id,
                user_id=principal.user_id,
                workspace_id=principal.workspace_id,
            )
            return row

    async def claim(self, pair_id, token):
        async with self.lock:
            row = self.get_pair(pair_id)
            if not secrets.compare_digest(
                row["claim_hash"], hashlib.sha256(token.encode()).digest()
            ):
                raise AgentError(403, "invalid_claim_token")
            if row["status"] == "claimed":
                raise AgentError(409, "pairing_already_claimed")
            result = {"status": row["status"]}
            if row["status"] == "approved":
                result.update(
                    api_key=row.pop("secret"),
                    key_id=row["key_id"],
                    user_id=row["user_id"],
                    workspace_id=row["workspace_id"],
                )
                row["status"] = "claimed"
            return result
