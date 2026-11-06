"""Short-lived app connections bound to the browser session and trusted ingress."""

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass

from studio.contracts.remote_desktop.apps import RemoteAppIceServer

TICKET_SECONDS = 30
MAX_TICKETS = 128


@dataclass(frozen=True)
class AppTicket:
    owner: str
    session: str
    local: bool
    app: str
    expires: float


class AppSessions:
    def __init__(self, *, clock=time.monotonic):
        self._clock = clock
        self._tickets: dict[str, AppTicket] = {}

    def issue(self, principal, local, app):
        now = self._clock()
        self._tickets = {key: value for key, value in self._tickets.items() if value.expires > now}
        if len(self._tickets) >= MAX_TICKETS:
            return None
        key = secrets.token_urlsafe(32)
        self._tickets[key] = AppTicket(
            principal.user_id, principal.session_id, local, app, now + TICKET_SECONDS
        )
        return key

    def take(self, key, principal, local):
        ticket = self._tickets.get(key)
        if ticket is None or ticket.expires <= self._clock():
            self._tickets.pop(key, None)
            return None
        if (ticket.owner, ticket.session, ticket.local) != (
            principal.user_id,
            principal.session_id,
            local,
        ):
            return None
        return self._tickets.pop(key)


def turn_servers(urls, secret, *, now=None):
    if not urls or not secret:
        return []
    endpoints = urls.split(",")
    if any(not endpoint.startswith(("turn:", "turns:")) for endpoint in endpoints):
        return []
    issued = int(time.time() if now is None else now)
    username = f"{issued + 3600}:{secrets.token_hex(8)}"
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    servers = [
        RemoteAppIceServer(
            urls=endpoints, username=username, credential=base64.b64encode(digest).decode()
        )
    ]
    discovery = [
        f"stun:{endpoint.removeprefix('turn:').split('?')[0]}"
        for endpoint in endpoints
        if endpoint.startswith("turn:") and endpoint.endswith("?transport=udp")
    ]
    if discovery:
        servers.insert(0, RemoteAppIceServer(urls=discovery, username="", credential=""))
    return servers
