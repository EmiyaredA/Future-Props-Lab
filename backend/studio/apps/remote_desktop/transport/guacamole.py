"""Guacamole VNC handshake and bounded, authenticated desktop transport."""

import asyncio
import base64
import io
import logging
import secrets
from contextlib import suppress
from dataclasses import dataclass

from PIL import Image, ImageFilter
from starlette.websockets import WebSocketDisconnect

from studio.apps.remote_desktop.clients.vnc_probe import password_rejected
from studio.contracts.identity.cloud_authority import (
    DESKTOP_COOKIE,
    TICKET_SECONDS,
    desktop_ticket_digest,
)

MAX_INSTRUCTION = 16 * 1024 * 1024
MAX_DESKTOP_FRAME = 24 * 1024 * 1024
LARGE_DESKTOP_FRAME = 64 * 1024
COMPRESSIBLE_IMAGES = {"image/png", "image/webp", "image/jpeg"}
IMAGE_CHUNK = 8000
log = logging.getLogger("uvicorn.error")


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


async def handshake(reader, writer, settings, password, *, local=True):
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
    image_types = ("image/png", "image/jpeg")
    if not local:
        image_types += ("image/webp",)
    for opcode, args in (
        ("size", ("1920", "1200", "96")),
        ("audio", ()),
        ("video", ()),
        ("image", image_types),
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


@dataclass
class DesktopTransfer:
    image_chunks: int = 0
    bytes_sent: int = 0
    sync_sent: int = 0
    sync_received: int = 0
    keepalives: int = 0


async def browser_input(socket, writer, inputs, transfer):
    last_keepalive = inputs.clock()
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
                now = inputs.clock()
                if now - last_keepalive >= 5:
                    # The tunnel can answer pings while the renderer is still
                    # receiving its first image and has no frame to acknowledge.
                    writer.write(instruction("nop"))
                    last_keepalive = now
            elif opcode == "fpl_release" and not args:
                inputs.release(writer)
            elif opcode in {"ack", "sync", "mouse", "key", "nop", "disconnect"}:
                active |= inputs.track(opcode, args)
                writer.write(message[start:end].encode())
                transfer.sync_received += opcode == "sync"
                transfer.keepalives += opcode == "nop"
                if opcode == "nop":
                    last_keepalive = inputs.clock()
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


def compress_desktop_tile(chunks):
    data = "".join(chunks)
    if len(data) < 16_384:
        return None
    try:
        with Image.open(
            io.BytesIO(base64.b64decode(data, validate=True)), formats=["PNG", "WEBP", "JPEG"]
        ) as image:
            if image.width * image.height > 8_000_000:
                return None
            output = io.BytesIO()
            image.save(output, "WEBP", quality=35, method=2)
            if output.tell() > image.width * image.height // 6:
                # Fine texture can dominate the transfer. Preserve tile
                # geometry and alpha while removing high-frequency color noise.
                preview = image.convert("RGB").filter(ImageFilter.GaussianBlur(1.3))
                if "A" in image.getbands() or "transparency" in image.info:
                    preview.putalpha(image.convert("RGBA").getchannel("A"))
                smaller = io.BytesIO()
                preview.save(smaller, "WEBP", quality=35, method=2)
                if smaller.tell() < output.tell():
                    output = smaller
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return encoded if len(encoded) < len(data) else None


def is_desktop_image(fields):
    return (
        len(fields) == 7
        and fields[0] == "img"
        and fields[3] == "0"
        and fields[4] in COMPRESSIBLE_IMAGES
    )


def compact_desktop_frame(frame):
    # guacd encodes tiles concurrently and can reuse an image stream index.
    # Keep each img and end at its original position, with any replacement data
    # occupying the first blob position for that stream.
    streams = {}
    replacements = {}
    for index, (fields, _) in enumerate(frame):
        if is_desktop_image(fields):
            streams[fields[1]] = (index, [], [])
        elif len(fields) >= 2 and fields[1] in streams:
            if len(fields) == 3 and fields[0] == "blob":
                _, positions, chunks = streams[fields[1]]
                positions.append(index)
                chunks.append(fields[2])
            elif fields[0] == "end":
                header, positions, chunks = streams.pop(fields[1])
                data = compress_desktop_tile(chunks)
                if data:
                    _, stream, mask, layer, _, x, y = frame[header][0]
                    replacements[header] = [
                        instruction("img", stream, mask, layer, "image/webp", x, y).decode()
                    ]
                    for position in positions:
                        replacements[position] = []
                    replacements[positions[0]] = [
                        instruction("blob", stream, data[start : start + IMAGE_CHUNK]).decode()
                        for start in range(0, len(data), IMAGE_CHUNK)
                    ]
    return [
        message
        for index, (_, raw) in enumerate(frame)
        for message in replacements.get(index, [raw])
    ]


class PublicDesktopImages:
    """Bound the size of large desktop updates sent over the public tunnel."""

    def __init__(self):
        self.first = True
        self.passthrough = False
        self.pending = []
        self.size = 0

    async def output(self, fields, raw):
        if self.passthrough:
            if fields[0] == "sync":
                self.passthrough = False
            return [raw]
        if not self.pending and not is_desktop_image(fields):
            return [raw]
        self.size += len(raw)
        if self.size > MAX_DESKTOP_FRAME:
            self.first = False
            self.passthrough = fields[0] != "sync"
            self.size = 0
            pending, self.pending = self.pending, []
            return [*[message for _, message in pending], raw]
        self.pending.append((fields, raw))
        if fields[0] != "sync":
            return []
        compact = self.first or self.size >= LARGE_DESKTOP_FRAME
        self.first = False
        self.size = 0
        pending, self.pending = self.pending, []
        if not compact:
            return [message for _, message in pending]
        return await asyncio.to_thread(compact_desktop_frame, pending)


async def browser_output(socket, reader, owner, ticket, settings, transfer, *, local, attempts):
    first_frame = True
    deadline = asyncio.get_running_loop().time() + 10
    images = None if local else PublicDesktopImages()
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
            attempts.clear(f"cloud-vnc:{owner}")
            first_frame = False
        messages = await images.output(fields, raw) if images else [raw]
        for message in messages:
            await socket.send_text(message)
            transfer.bytes_sent += len(message)
        transfer.image_chunks += fields[0] in {"blob", "png", "jpeg", "webp"}
        transfer.sync_sent += fields[0] == "sync"


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
    def __init__(self, *, settings, access, connect_upstream, attempts):
        self.attempts = attempts
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
            await self.bridge(socket, principal, ticket, check, local=local)

    async def bridge(self, socket, principal, ticket, check, *, local):
        clock = asyncio.get_running_loop().time
        started = clock()
        inputs = DesktopInput(clock)
        transfer = DesktopTransfer()
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
                await handshake(reader, writer, settings, ticket.password, local=local)
            if revoked.is_set() or await check() is None:
                reason = "desktop_authorization_required"
                return
            inputs.last_activity = inputs.clock()
            watcher = asyncio.create_task(watch_access(inputs, changed, check))
            control = asyncio.create_task(revoked.wait())
            tasks = [
                asyncio.create_task(browser_input(socket, writer, inputs, transfer)),
                asyncio.create_task(
                    browser_output(
                        socket,
                        reader,
                        principal.user_id,
                        ticket,
                        settings,
                        transfer,
                        local=local,
                        attempts=self.attempts,
                    )
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
            if not local and (reason == "desktop_unavailable" or transfer.sync_received == 0):
                log.warning(
                    "Public desktop ended after %.1fs: reason=%s, sent_chars=%d, image_chunks=%d, "
                    "sync_sent=%d, sync_received=%d, keepalives=%d",
                    clock() - started,
                    reason or "connection_closed",
                    transfer.bytes_sent,
                    transfer.image_chunks,
                    transfer.sync_sent,
                    transfer.sync_received,
                    transfer.keepalives,
                )
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
