"""Guacamole VNC handshake and bounded, authenticated desktop transport."""

import asyncio
import secrets
from contextlib import suppress
from dataclasses import dataclass

from starlette.websockets import WebSocketDisconnect

from app.capabilities.identity.rate_limit import clear_attempts
from fpl_runtime.cloud_authority import DESKTOP_COOKIE, TICKET_SECONDS, desktop_ticket_digest

from .vnc_check import password_rejected

MAX_INSTRUCTION = 16 * 1024 * 1024


def instruction(opcode, *args):
    return (",".join(f"{len(value)}.{value}" for value in (opcode, *args)) + ";").encode()


def parse_instruction(data, start=0):
    """Read one complete Guacamole instruction from a UTF-8 decoded stream."""
    fields = []
    while len(fields) < 256:
        dot = data.find(".", start, start + 9)
        if dot < 0:
            if (
                len(data) - start >= 9
                or (data[start:] and not data[start:].isascii())
                or (data[start:] and not data[start:].isdigit())
            ):
                raise ValueError("Invalid Guacamole element length")
            return None
        size = data[start:dot]
        if not size.isascii() or not size.isdecimal():
            raise ValueError("Invalid Guacamole element length")
        end = dot + 1 + int(size)
        if end >= len(data):
            return None
        fields.append(data[dot + 1 : end])
        delimiter = data[end]
        start = end + 1
        if delimiter == ";":
            return fields, start
        if delimiter != ",":
            raise ValueError("Invalid Guacamole delimiter")
    raise ValueError("Too many Guacamole elements")


class GuacdReader:
    def __init__(self, stream):
        import codecs

        self.stream = stream
        self.decoder = codecs.getincrementaldecoder("utf-8")()
        self.buffer = ""

    async def next(self):
        while True:
            parsed = parse_instruction(self.buffer)
            if parsed:
                fields, end = parsed
                raw, self.buffer = self.buffer[:end], self.buffer[end:]
                return fields, raw
            data = await self.stream.read(65536)
            if not data:
                raise EOFError
            self.buffer += self.decoder.decode(data)
            if len(self.buffer) > MAX_INSTRUCTION:
                raise ValueError("Guacamole instruction exceeds limit")


async def handshake(reader, writer, settings, password):
    writer.write(instruction("select", "vnc"))
    await writer.drain()
    fields, _ = await reader.next()
    if fields[0] != "args":
        raise ValueError("Unexpected guacd handshake")
    params = {
        "hostname": settings.fpl_cloud_control_vnc_host,
        "port": str(settings.fpl_cloud_control_vnc_port),
        "password": password,
        "disable-audio": "true",
        "disable-copy": "true",
        "disable-paste": "true",
        "disable-server-input": "false",
    }
    values = [
        "VERSION_1_5_0" if arg.startswith("VERSION_") else params.get(arg, "") for arg in fields[1:]
    ]
    for opcode, args in (
        ("size", ("1920", "1200", "96")),
        ("audio", ()),
        ("video", ()),
        ("image", ("image/png", "image/jpeg")),
        ("timezone", ("UTC",)),
        ("connect", values),
    ):
        writer.write(instruction(opcode, *args))
    await writer.drain()
    fields, _ = await reader.next()
    if fields[0] != "ready":
        raise ValueError("guacd did not establish a VNC session")


class DesktopInput:
    def __init__(self, clock):
        self.clock = clock
        self.last_activity = clock()
        self.keys = set()
        self.mouse = (0, 0, 0)

    def track(self, opcode, args):
        if opcode == "key":
            if len(args) != 2 or args[1] not in ("0", "1"):
                raise ValueError("Invalid desktop key")
            symbol, pressed = int(args[0]), args[1] == "1"
            if not 0 < symbol <= 0x1FFFFFFF or (pressed and len(self.keys) >= 256):
                raise ValueError("Invalid desktop key")
            changed = (symbol in self.keys) != pressed
            if pressed:
                self.keys.add(symbol)
            else:
                self.keys.discard(symbol)
            return changed
        if opcode == "mouse":
            if len(args) != 3:
                raise ValueError("Invalid desktop pointer")
            x, y, buttons = map(int, args)
            if not (-65535 <= x <= 65535 and -65535 <= y <= 65535 and 0 <= buttons <= 31):
                raise ValueError("Invalid desktop pointer")
            previous, self.mouse = self.mouse, (x, y, buttons)
            return previous != self.mouse
        return False

    def release(self, writer):
        for symbol in sorted(self.keys):
            writer.write(instruction("key", str(symbol), "0"))
        self.keys.clear()
        x, y, buttons = self.mouse
        if buttons:
            writer.write(instruction("mouse", str(x), str(y), "0"))
            self.mouse = (x, y, 0)


async def browser_input(socket, writer, inputs):
    while True:
        message = await socket.receive_text()
        if not message or len(message) > 8192:
            raise ValueError("Invalid desktop input")
        start = 0
        active = False
        while start < len(message):
            parsed = parse_instruction(message, start)
            if not parsed:
                raise ValueError("Incomplete desktop input")
            (opcode, *args), end = parsed
            if opcode == "" and len(args) == 2 and args[0] == "ping":
                await socket.send_text(message[start:end])
            elif opcode == "fpl_release" and not args:
                inputs.release(writer)
            elif opcode in {"ack", "sync", "mouse", "key", "nop", "disconnect"}:
                active |= inputs.track(opcode, args)
                writer.write(message[start:end].encode())
            else:
                raise ValueError("Desktop input opcode denied")
            start = end
        await writer.drain()
        if active:
            inputs.last_activity = inputs.clock()


def upstream_error(fields):
    if fields[0] == "require":
        return "desktop_password_invalid"
    if fields[0] == "error" and len(fields) >= 3:
        message = fields[1].casefold()
        if fields[2] in {"769", "771"} or any(
            word in message
            for word in ("authentication failed", "incorrect password", "invalid password")
        ):
            return "desktop_password_invalid"
    return "desktop_unavailable"


async def browser_output(socket, reader, owner, ticket, settings):
    first_frame = True
    deadline = asyncio.get_running_loop().time() + 10
    while True:
        if first_frame:
            async with asyncio.timeout_at(deadline):
                fields, raw = await reader.next()
        else:
            fields, raw = await reader.next()
        if fields[0] in {"error", "disconnect", "require", "argv", "msg"}:
            reason = upstream_error(fields)
            if (
                first_frame
                and reason == "desktop_unavailable"
                and fields[0] == "error"
                and fields[2:3] == ["519"]
                and await password_rejected(settings, ticket.password)
            ):
                reason = "desktop_password_invalid"
            return reason
        if first_frame and fields[0] == "sync":
            ticket.password = ""
            clear_attempts(f"cloud-vnc:{owner}")
            first_frame = False
        await socket.send_text(raw)


async def watch_access(inputs, changed, check):
    while True:
        changed.clear()
        minutes = await check()
        if minutes is None:
            return "desktop_authorization_required"
        remaining = inputs.last_activity + minutes * 60 - inputs.clock()
        if remaining <= 0:
            return "desktop_idle_timeout"
        with suppress(TimeoutError):
            await asyncio.wait_for(changed.wait(), min(2, remaining))


@dataclass(repr=False)
class DesktopTicket:
    scope: tuple
    password: str
    expiry: asyncio.TimerHandle


class DesktopConnection:
    def __init__(self, *, settings, access, connect_upstream):
        self.settings = settings
        self.access = access
        self.connect_upstream = connect_upstream
        self.lock = asyncio.Lock()
        self.tickets = {}
        self.active = None

    @staticmethod
    def scope(principal, local, epoch):
        return principal.user_id, principal.session_id, local, epoch

    def discard(self, token):
        ticket = self.tickets.pop(token, None)
        if ticket:
            ticket.expiry.cancel()
        return ticket

    def issue(self, principal, local, password, *, epoch=None):
        scope = self.scope(principal, local, epoch)
        for token, ticket in list(self.tickets.items()):
            if ticket.scope == scope:
                self.discard(token)
        if len(self.tickets) >= 128:
            return None
        token = secrets.token_urlsafe(32)
        digest = desktop_ticket_digest(token)
        expiry = asyncio.get_running_loop().call_later(TICKET_SECONDS, self.discard, digest)
        self.tickets[digest] = DesktopTicket(scope, password, expiry)
        return token

    def revoke(self, owner):
        for token, ticket in list(self.tickets.items()):
            if ticket.scope[0] == owner:
                self.discard(token)
        if self.active and self.active[0] == owner:
            self.active[1].set()

    def update_idle(self, owner):
        if self.active and self.active[0] == owner:
            self.active[2].set()

    async def connect(self, socket, principal, local, *, proof=None, context=None, epoch=None):
        digest = (
            proof
            if proof is not None
            else desktop_ticket_digest(socket.cookies.get(DESKTOP_COOKIE, ""))
        )
        ticket = self.tickets.get(digest)
        if ticket is None or ticket.scope != self.scope(principal, local, epoch):
            await socket.close(4403)
            return
        self.discard(digest)

        async def check():
            return await self.access(principal, local, context, epoch)

        if await check() is None:
            await socket.close(4403)
            return
        await socket.accept(subprotocol="guacamole")
        await socket.send_text(instruction("", "fpl-desktop").decode())
        if self.lock.locked():
            await socket.send_text(instruction("error", "desktop_busy", "512").decode())
            await socket.close()
            return
        async with self.lock:
            await self.bridge(socket, principal, ticket, check)

    async def bridge(self, socket, principal, ticket, check):
        inputs = DesktopInput(asyncio.get_running_loop().time)
        revoked = asyncio.Event()
        changed = asyncio.Event()
        self.active = (principal.user_id, revoked, changed)
        reason = None
        writer = None
        tasks = []
        try:
            async with asyncio.timeout(10):
                settings = self.settings()
                stream, writer = await self.connect_upstream(settings)
                reader = GuacdReader(stream)
                await handshake(reader, writer, settings, ticket.password)
            if revoked.is_set() or await check() is None:
                reason = "desktop_authorization_required"
                return
            inputs.last_activity = inputs.clock()
            watcher = asyncio.create_task(watch_access(inputs, changed, check))
            control = asyncio.create_task(revoked.wait())
            tasks = [
                asyncio.create_task(browser_input(socket, writer, inputs)),
                asyncio.create_task(
                    browser_output(socket, reader, principal.user_id, ticket, settings)
                ),
                watcher,
                control,
            ]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            reason = (
                "desktop_authorization_required"
                if control in done
                else next((task.result() for task in done if task is not tasks[0]), None)
            )
        except WebSocketDisconnect:
            pass
        except (OSError, TimeoutError, EOFError, ValueError):
            reason = "desktop_unavailable"
        finally:
            ticket.password = ""
            self.active = None
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if writer:
                with suppress(OSError, TimeoutError):
                    async with asyncio.timeout(1):
                        inputs.release(writer)
                        await writer.drain()
                writer.close()
                with suppress(OSError, TimeoutError):
                    async with asyncio.timeout(2):
                        await writer.wait_closed()
            with suppress(RuntimeError, OSError, WebSocketDisconnect):
                if reason:
                    await socket.send_text(instruction("error", reason, "512").decode())
                await socket.close()
